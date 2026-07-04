const { Pool } = require('pg');
const amqp = require('amqplib');

// Este servicio no expone API HTTP ya que  solo escucha RabbitMQ
// Por eso no necesita cors, express.json, ni un puerto.
const DB_URL = process.env.DATABASE_URL || 'postgres://atc:atc123@postgres-pistas:5432/pistas';
const RABBIT_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';
const EXCHANGE = 'atc.exchange';// Es el mismo exchange fisico en RabbitMQ para los 3 servicios 

const pool = new Pool({ connectionString: DB_URL });

async function start() {
  const conn = await amqp.connect(RABBIT_URL);
  const ch = await conn.createChannel();

  // por si Pistas arranca antes que Vuelos
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });

  // Cola PROPIA de este servicio, con nombre distinto a la de Vuelos y Tasas.
  // Si dos servicios compartieran la misma cola, RabbitMQ repartiría los mensajes entre ellos (round-robin)
  // en vez de que cada servicio reciba su propia copia completa del evento.
  const q = await ch.assertQueue('pistas.solicitud.vuelo', { durable: true });

  // Se suscribe unicamente a mensajes publicados con routing key 'vuelo.solicitud', los que emite Vuelos.
  await ch.bindQueue(q.queue, EXCHANGE, 'vuelo.solicitud');

  console.log('[Pistas] Esperando SolicitudVuelo...');

  ch.consume(q.queue, async (msg) => {
    if (!msg) return;
    try {
      const data = JSON.parse(msg.content.toString());
      console.log('[Pistas] SolicitudVuelo recibida:', data.vuelo_id);

      // FOR UPDATE bloquea las filas que devuelve el SELECT hasta que termine la transacción/query,
      // para que dos instancias de Pistas corriendo en paralelo (ejemplo 3 replicas en K3s) no puedan
      // leer la misma pista libre al mismo tiempo y asignarla dos veces
      // SKIP LOCKED si otra instancia ya está procesando esa fila (está bloqueada), este SELECT
      // simplemente la salta y busca la siguiente libre, en vez de quedarse esperando el lock
      const result = await pool.query(
        `UPDATE pistas SET estado = 'OCUPADA'
         WHERE pista_id = (
           SELECT pista_id FROM pistas
           WHERE estado = 'LIBRE'
           ORDER BY pista_id
           LIMIT 1
           FOR UPDATE SKIP LOCKED
         )
         RETURNING pista_id, tipo_pista`
      );
      // Las consultas SQL como esta son clave porque esto es lo que hace posible escalar este servicio horizontalmente sin condiciones de carrera

      if (result.rows.length === 0) {
        console.error('[Pistas] No hay pistas libres:', data.vuelo_id);
        // nack con requeue=true hace que el mensaje vuelve a la cola para reintentarse más tarde, cuando alguna pista se libere
        // Sin esto, esta solicitud de vuelo se perderia silenciosamente.
        ch.nack(msg, false, true);
        return; // no se debe seguir al ch.ack() de abajo si no hubo pista
      }

      const { pista_id, tipo_pista } = result.rows[0];

      // Se marca OCUPADA inmediatamente, dentro del mismo flujo que la selecciono, para que
      // la próxima solicitud o el SELECT de otra replica ya no la vea como candidata
      const event = {
        evento: 'AsignacionPista',
        vuelo_id: data.vuelo_id, // se propaga el mismo vuelo_id para que Tasas (y luego Vuelos) puedan correlacionar el evento con el vuelo original
        pista_id,
        tipo_pista,
        hora_asignacion: new Date().toISOString(),
        estado: 'ASIGNADA'
      };

      // Publica el siguiente evento de la cadena con su propia routing key, distinta a la que consumio
      // esto es lo que hace avanzar el flujo, y tasas esta escuchando justamente 'pista.asignacion'
      ch.publish(EXCHANGE, 'pista.asignacion', Buffer.from(JSON.stringify(event)));
      console.log('[Pistas] AsignacionPista publicada:', data.vuelo_id, pista_id);

      ch.ack(msg); // recien aca se confirma el mensaje original; si algo de lo anterior falla, cae al catch y no se hace ack
    } catch (err) {
      console.error('[Pistas] Error procesando solicitud:', err);
      ch.nack(msg, false, true);
    }
  });
  // Liberar la pista cuando el proceso del vuelo se completa
  const qLiberar = await ch.assertQueue('pistas.proceso.completado', { durable: true });
  await ch.bindQueue(qLiberar.queue, EXCHANGE, 'proceso.completado');

  // Tiempo que la pista permanece ocupada tras completarse el proceso (simula el aterrizaje)
  const LIBERACION_DELAY_MS = parseInt(process.env.LIBERACION_DELAY_MS || '15000', 10);

  ch.consume(qLiberar.queue, (msg) => {
    if (!msg) return;
    const data = JSON.parse(msg.content.toString());
    console.log('[Pistas] Vuelo completado:', data.vuelo_id, '- pista', data.pista_id, 'se libera en', LIBERACION_DELAY_MS / 1000, 's');
    setTimeout(async () => {
      try {
        await pool.query("UPDATE pistas SET estado = 'LIBRE' WHERE pista_id = $1", [data.pista_id]);
        console.log('[Pistas] Pista liberada:', data.pista_id, '(vuelo:', data.vuelo_id + ')');
        ch.ack(msg);
      } catch (err) {
        console.error('[Pistas] Error liberando pista:', err);
        ch.nack(msg, false, true);
      }
    }, LIBERACION_DELAY_MS);
  });
}

start().catch((err) => {
  console.error('[Pistas] Error iniciando servicio:', err);
  process.exit(1);
});

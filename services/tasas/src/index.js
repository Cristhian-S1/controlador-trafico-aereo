const { Pool } = require('pg');
const amqp = require('amqplib');

// Igual que Pistas es un worker sin API HTTP, solo consume/produce eventos.
const DB_URL = process.env.DATABASE_URL || 'postgres://atc:atc123@postgres-tasas:5432/tasas';
const RABBIT_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';
const EXCHANGE = 'atc.exchange';
const PROCESO_DELAY_MS = parseInt(process.env.PROCESO_DELAY_MS || '8000', 10);

const TARIFAS = {
  COMERCIAL: { aterrizaje: 250, estacionamiento: 50 },
  CARGA: { aterrizaje: 200, estacionamiento: 80 },
  PRIVADO: { aterrizaje: 150, estacionamiento: 30 }
};

const pool = new Pool({ connectionString: DB_URL });

async function start() {
  const conn = await amqp.connect(RABBIT_URL);
  const ch = await conn.createChannel();
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });

  // Tercera cola propia del sistema, bindeada a la routing key que publica Pistas.
  const q = await ch.assertQueue('tasas.asignacion.pista', { durable: true });
  await ch.bindQueue(q.queue, EXCHANGE, 'pista.asignacion');

  console.log('[Tasas] Esperando AsignacionPista...');

  ch.consume(q.queue, async (msg) => {
    if (!msg) return;
    let data;
    try {
      data = JSON.parse(msg.content.toString());
    } catch {
      console.error('[Tasas] JSON invalido en AsignacionPista, descartando mensaje');
      ch.ack(msg);
      return;
    }
    try {
      console.log('[Tasas] AsignacionPista recibida:', data.vuelo_id, '- calculando tasas...');

      // Tiempo de procesamiento simulado (hace visible el estado ASIGNADA)
      await new Promise((r) => setTimeout(r, PROCESO_DELAY_MS));

      // Si tipo_pista viene con un valor inesperado (no está¿a en TARIFAS), se usa COMERCIAL como
      // fallback seguro en vez de que el servicio explote con 'undefined.aterrizaje'.
      const tarifa = TARIFAS[data.tipo_pista] || TARIFAS.COMERCIAL;
      const total = tarifa.aterrizaje + tarifa.estacionamiento;

      // Se persiste el detalle del cobro (no solo el total) para trazabilidad y auditoraa
      // permite después explicarle  luego lo que se cobro
      await pool.query(
        `INSERT INTO tasas (vuelo_id, pista_id, costo_aterrizaje, costo_estacionamiento, costo_total, moneda)
         VALUES ($1, $2, $3, $4, $5, 'USD')`,
        [data.vuelo_id, data.pista_id, tarifa.aterrizaje, tarifa.estacionamiento, total]
      );

      const event = {
        evento: 'ProcesoCompletado', // nombre del evento que Vuelos está escuchando para cerrar el ciclo
        vuelo_id: data.vuelo_id,
        pista_id: data.pista_id, // se vuelve a propagar aunque Tasas no lo genero, para que Vuelos no tenga que ir a buscarlo a otra parte
        tasa: {
          aterrizaje: tarifa.aterrizaje,
          estacionamiento: tarifa.estacionamiento,
          total,
          moneda: 'USD'
        },
        timestamp: new Date().toISOString(),
        estado: 'COMPLETADO'
      };

      // ultima publicacion de la cadena routing key 'proceso.completado' es la que consume Vuelos,
      // cerrando el ciclo Vuelos -> Pistas -> Tasas -> Vuelos.
      ch.publish(EXCHANGE, 'proceso.completado', Buffer.from(JSON.stringify(event)));
      console.log('[Tasas] ProcesoCompletado publicado:', data.vuelo_id);

      ch.ack(msg);
    } catch (err) {
      console.error('[Tasas] Error procesando asignacion:', err);
      ch.nack(msg, false, true);
    }
  });
}

start().catch((err) => {
  console.error('[Tasas] Error iniciando servicio:', err);
  process.exit(1);
});

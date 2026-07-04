const { Pool } = require('pg');
const amqp = require('amqplib');

const DB_URL = process.env.DATABASE_URL || 'postgres://atc:atc123@postgres-pistas:5432/pistas';
const RABBIT_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';
const EXCHANGE = 'atc.exchange';

const pool = new Pool({ connectionString: DB_URL });

async function start() {
  const conn = await amqp.connect(RABBIT_URL);
  const ch = await conn.createChannel();
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });

  const q = await ch.assertQueue('pistas.solicitud.vuelo', { durable: true });
  await ch.bindQueue(q.queue, EXCHANGE, 'vuelo.solicitud');

  console.log('[Pistas] Esperando SolicitudVuelo...');

  ch.consume(q.queue, async (msg) => {
    if (!msg) return;
    try {
      const data = JSON.parse(msg.content.toString());
      console.log('[Pistas] SolicitudVuelo recibida:', data.vuelo_id);

      // Operacion atomica: buscar pista libre y ocuparla en una sola sentencia.
      // Evita que dos mensajes concurrentes reserven la misma pista.
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

      if (result.rows.length === 0) {
        console.error('[Pistas] No hay pistas libres:', data.vuelo_id);
        ch.nack(msg, false, true);
        return;
      }

      const { pista_id, tipo_pista } = result.rows[0];

      const event = {
        evento: 'AsignacionPista',
        vuelo_id: data.vuelo_id,
        pista_id,
        tipo_pista,
        hora_asignacion: new Date().toISOString(),
        estado: 'ASIGNADA'
      };

      ch.publish(EXCHANGE, 'pista.asignacion', Buffer.from(JSON.stringify(event)));
      console.log('[Pistas] AsignacionPista publicada:', data.vuelo_id, pista_id);

      ch.ack(msg);
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

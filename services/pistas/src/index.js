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

      const result = await pool.query(
        "SELECT pista_id, tipo_pista FROM pistas WHERE estado = 'LIBRE' ORDER BY pista_id LIMIT 1 FOR UPDATE SKIP LOCKED"
      );

      if (result.rows.length === 0) {
        console.error('[Pistas] No hay pistas libres:', data.vuelo_id);
        ch.nack(msg, false, true);
        return;
      }

      const { pista_id, tipo_pista } = result.rows[0];

      await pool.query(
        "UPDATE pistas SET estado = 'OCUPADA' WHERE pista_id = $1",
        [pista_id]
      );

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
}

start().catch((err) => {
  console.error('[Pistas] Error iniciando servicio:', err);
  process.exit(1);
});

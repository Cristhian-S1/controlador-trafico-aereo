const { Pool } = require('pg');
const amqp = require('amqplib');

const DB_URL = process.env.DATABASE_URL || 'postgres://atc:atc123@postgres-tasas:5432/tasas';
const RABBIT_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';
const EXCHANGE = 'atc.exchange';

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

  const q = await ch.assertQueue('tasas.asignacion.pista', { durable: true });
  await ch.bindQueue(q.queue, EXCHANGE, 'pista.asignacion');

  console.log('[Tasas] Esperando AsignacionPista...');

  ch.consume(q.queue, async (msg) => {
    if (!msg) return;
    try {
      const data = JSON.parse(msg.content.toString());
      console.log('[Tasas] AsignacionPista recibida:', data.vuelo_id);

      const tarifa = TARIFAS[data.tipo_pista] || TARIFAS.COMERCIAL;
      const total = tarifa.aterrizaje + tarifa.estacionamiento;

      await pool.query(
        `INSERT INTO tasas (vuelo_id, pista_id, costo_aterrizaje, costo_estacionamiento, costo_total, moneda)
         VALUES ($1, $2, $3, $4, $5, 'USD')`,
        [data.vuelo_id, data.pista_id, tarifa.aterrizaje, tarifa.estacionamiento, total]
      );

      const event = {
        evento: 'ProcesoCompletado',
        vuelo_id: data.vuelo_id,
        pista_id: data.pista_id,
        tasa: {
          aterrizaje: tarifa.aterrizaje,
          estacionamiento: tarifa.estacionamiento,
          total,
          moneda: 'USD'
        },
        timestamp: new Date().toISOString(),
        estado: 'COMPLETADO'
      };

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

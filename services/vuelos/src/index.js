const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const amqp = require('amqplib');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const DB_URL = process.env.DATABASE_URL || 'postgres://atc:atc123@postgres-vuelos:5432/vuelos';
const RABBIT_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';
const EXCHANGE = 'atc.exchange';

const pool = new Pool({ connectionString: DB_URL });

let channel = null;
const sseClients = new Set();

async function connectRabbit() {
  const conn = await amqp.connect(RABBIT_URL);
  channel = await conn.createChannel();
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });

  const q = await channel.assertQueue('vuelos.proceso.completado', { durable: true });
  await channel.bindQueue(q.queue, EXCHANGE, 'proceso.completado');

  channel.consume(q.queue, async (msg) => {
    if (!msg) return;
    try {
      const data = JSON.parse(msg.content.toString());
      console.log('[Vuelos] ProcesoCompletado recibido:', data.vuelo_id);

      await pool.query(
        'UPDATE vuelos SET estado = $1 WHERE vuelo_id = $2',
        ['COMPLETADO', data.vuelo_id]
      );

      const eventPayload = JSON.stringify({
        evento: 'ProcesoCompletado',
        vuelo_id: data.vuelo_id,
        pista_id: data.pista_id,
        tasa: data.tasa,
        estado: 'COMPLETADO'
      });

      sseClients.forEach((client) => {
        client.write(`data: ${eventPayload}\n\n`);
      });

      channel.ack(msg);
    } catch (err) {
      console.error('[Vuelos] Error procesando ProcesoCompletado:', err);
      channel.nack(msg, false, true);
    }
  });
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'vuelos' });
});

app.post('/api/vuelos', async (req, res) => {
  try {
    const { vuelo_id, aerolinea, numero_vuelo, origen, destino, aeronave, pasajeros } = req.body;

    if (!vuelo_id || !aerolinea || !numero_vuelo || !origen || !destino || !aeronave || pasajeros === undefined) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    await pool.query(
      `INSERT INTO vuelos (vuelo_id, aerolinea, numero_vuelo, origen, destino, aeronave, pasajeros, estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDIENTE')`,
      [vuelo_id, aerolinea, numero_vuelo, origen, destino, aeronave, pasajeros]
    );

    const event = {
      evento: 'SolicitudVuelo',
      vuelo_id,
      aerolinea,
      numero_vuelo,
      origen,
      destino,
      aeronave,
      pasajeros,
      timestamp: new Date().toISOString(),
      estado: 'PENDIENTE'
    };

    channel.publish(EXCHANGE, 'vuelo.solicitud', Buffer.from(JSON.stringify(event)));
    console.log('[Vuelos] SolicitudVuelo publicada:', vuelo_id);

    res.status(201).json(event);
  } catch (err) {
    console.error('[Vuelos] Error creando vuelo:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/vuelos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM vuelos ORDER BY timestamp_solicitud DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('[Vuelos] Error listando vuelos:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/vuelos/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM vuelos WHERE vuelo_id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Vuelo no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Vuelos] Error obteniendo vuelo:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/vuelos/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

async function start() {
  await connectRabbit();
  app.listen(PORT, () => {
    console.log(`[Vuelos] Servicio escuchando en puerto ${PORT}`);
  });
}

start().catch((err) => {
  console.error('[Vuelos] Error iniciando servicio:', err);
  process.exit(1);
});

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const amqp = require('amqplib');

const app = express();
app.use(cors()); // Para que el frontend consuma la API sin bloqueo del navegador
app.use(express.json()); // parsea automáticamente el body de las requests como JSON -> req.body

const PORT = process.env.PORT || 3001;

// Fallbacks locales para poder correr el servicio fuera de K3s (en mi maquina en este caso) sin configurar nada.
// En el cluster, estas variables vienen inyectadas por ConfigMap/Secret, no se usan los defaults.
const DB_URL = process.env.DATABASE_URL || 'postgres://atc:atc123@postgres-vuelos:5432/vuelos';
const RABBIT_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';

// Nombre del exchange compartido por TODO el sistema. Los 3 servicios deben usar el mismo string exacto,
// porque un exchange en RabbitMQ es identificado por nombre; si alguien lo escribe distinto, crea uno nuevo vacío.
const EXCHANGE = 'atc.exchange';

// Pool de conexiones a Postgres (no una sola conexion) para poder atender varias requests en paralelo sin que una query lenta bloquee a las demás.
const pool = new Pool({ connectionString: DB_URL });

// 'channel' se guarda en una variable de modulo porque se necesita tanto dentro de connectRabbit()
// como en el handler de POST /api/vuelos (para publicar). Se inicializa en null porque hasta que
// connectRabbit() termine, todavía no existe canal utilizable.
let channel = null;

// Guarda las conexiones SSE abiertas (una por cliente conectado a /api/vuelos/events).
// Es un Set y no un array simple para poder agregar/quitar clientes en O(1) sin buscar indices.
const sseClients = new Set();

async function connectRabbit() {
  const conn = await amqp.connect(RABBIT_URL);
  channel = await conn.createChannel();

  // 'topic' porque necesitamos enrutar por patrones jerárquicos de routing key (vuelo.solicitud, pista.asignacion, etc.),
  // no un simple broadcast (fanout) ni una coincidencia exacta 1:1 (direct).
  // durable:true = el exchange sobrevive a un reinicio de RabbitMQ (no se pierde la definición del exchange).
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });

  // assertQueue crea la cola si no existe, o la reutiliza si ya existe (idempotente, seguro de llamar en cada arranque).
  // durable:true = los mensajes en esta cola sobreviven a un reinicio del broker (no se pierden si RabbitMQ se cae).
  const q = await channel.assertQueue('vuelos.proceso.completado', { durable: true });
  
  // El binding es lo que realmente conecta esta cola a los mensajes publicados con routing key 'proceso.completado'.
  // Sin este bind, la cola existiría pero nunca recibiría nada aunque el exchange reciba ese evento.
  await channel.bindQueue(q.queue, EXCHANGE, 'proceso.completado');

  // Estado intermedio: marcar ASIGNADA cuando pistas asigna una pista
  const qAsignada = await channel.assertQueue('vuelos.pista.asignada', { durable: true });
  await channel.bindQueue(qAsignada.queue, EXCHANGE, 'pista.asignacion');

  // channel.consume registra un callback que se dispara por cada mensaje que llegue a la cola.
  // Es asíncrono y long-running: este código queda "escuchando" indefinidamente, no es un fetch puntual.
  channel.consume(qAsignada.queue, async (msg) => {
    if (!msg) return;
    let data;
    try {
      data = JSON.parse(msg.content.toString());
    } catch {
      console.error('[Vuelos] JSON invalido en AsignacionPista, descartando mensaje');
      channel.ack(msg);
      return;
    }
    try {
      console.log('[Vuelos] AsignacionPista recibida:', data.vuelo_id, '- pista', data.pista_id);

      await pool.query(
        "UPDATE vuelos SET estado = 'ASIGNADA' WHERE vuelo_id = $1 AND estado = 'PENDIENTE'",
        [data.vuelo_id]
      );

      // Se arma un payload "plano" (no se reenvía el mensaje crudo de RabbitMQ) para desacoplar
      // el formato interno del bus de eventos del formato que consume el frontend por SSE.
      const eventPayload = JSON.stringify({
        evento: 'AsignacionPista',
        vuelo_id: data.vuelo_id,
        pista_id: data.pista_id,
        estado: 'ASIGNADA'
      });
      // Reenvía el evento a TODOS los clientes SSE conectados en este momento (broadcast simple en memoria).
      // Ojo: esto solo llega a los clientes conectados a ESTA instancia del pod; si escalas Vuelos a 2+ réplicas,
      // un cliente conectado al pod A no se entera de eventos consumidos por el pod B.
      sseClients.forEach((client) => {
        client.write(`data: ${eventPayload}\n\n`); // formato exigido por el protocolo SSE: "data: <json>\n\n"
      });

      channel.ack(msg); // confirma a RabbitMQ que el mensaje se procesó bien -> se elimina de la cola
    } catch (err) {
      console.error('[Vuelos] Error procesando AsignacionPista:', err);
      // nack con requeue=true: el mensaje vuelve a la cola para reintentarse (ej. si fue un error transitorio de DB).
      // Riesgo: si el error es determinístico (ej. JSON malformado), este mensaje reintentará para siempre.
      channel.nack(msg, false, true);
    }
  });

  channel.consume(q.queue, async (msg) => {
    if (!msg) return;
    let data;
    try {
      data = JSON.parse(msg.content.toString());
    } catch {
      console.error('[Vuelos] JSON invalido en ProcesoCompletado, descartando mensaje');
      channel.ack(msg);
      return;
    }
    try {
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

// Endpoint de salud simple y tipico para que Kubernetes (liveness/readiness probes) sepa si el pod esta vivo.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'vuelos' });
});

// Punto de entrada del sistema completo, aca nace un vuelo nuevo
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

    // Publica al exchange (no directo a una cola) con routing key 'vuelo.solicitud'.
    // Vuelos no sabe ni le importa quién esta escuchando esa routing key (por ahora es Pistas pero podria ser otra).
    // Buffer.from(...) porque amqplib exige que el body del mensaje sea binario, no un string plano.
    channel.publish(EXCHANGE, 'vuelo.solicitud', Buffer.from(JSON.stringify(event)));
    console.log('[Vuelos] SolicitudVuelo publicada:', vuelo_id);

    res.status(201).json(event);
  } catch (err) {
    console.error('[Vuelos] Error creando vuelo:', err);
    res.status(500).json({ error: err.message });
  }
});

// Listado de vuelos, ordenado por más reciente primero
app.get('/api/vuelos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM vuelos ORDER BY timestamp_solicitud DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('[Vuelos] Error listando vuelos:', err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint SSE que mantiene la conexión HTTP abierta indefinidamente para hacer push de eventos al frontend,
// en vez de que el frontend tenga que hacer polling cada X segundos.
app.get('/api/vuelos/events', (req, res) => {
  // Estos 3 headers son los que le dicen al navegador "esto es un stream SSE, no una respuesta normal":
  res.setHeader('Content-Type', 'text/event-stream'); // MIME type exigido por la spec de SSE
  res.setHeader('Cache-Control', 'no-cache'); // evita que un proxy/CDN intente cachear el stream
  res.setHeader('Connection', 'keep-alive'); // mantiene el socket TCP abierto en vez de cerrarlo tras la respuesta
  res.flushHeaders(); // envia los headers de inmediato, sin esperar el primer chunk de datos

  sseClients.add(res); // se guarda el objeto 'response' mismo, porque .write() sobre el es lo que empuja datos

  // Cuando el cliente cierra la pestaña o pierde conexion, Node dispara 'close' en el request.
  // Sin este cleanup, sseClients creceria para siempre con conexiones muertas (memory leak).
  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Detalle de un vuelo puntual por su vuelo_id, no por el id autoincremental de la tabla
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

async function start() {
  await connectRabbit(); // se espera a que RabbitMQ esté listo ANTES de aceptar trafico HTTP,
  // porque si un POST /api/vuelos llega antes de que 'channel' exista, channel.publish() explotaria.
  app.listen(PORT, () => {
    console.log(`[Vuelos] Servicio escuchando en puerto ${PORT}`);
  });
}

start().catch((err) => {
  console.error('[Vuelos] Error iniciando servicio:', err);
  process.exit(1); // sale con código de error para que Kubernetes detecte el crash y reinicie el pod (CrashLoopBackOff -> restart)
});

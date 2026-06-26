const amqp = require('amqplib');

const RABBIT_URL = process.env.RABBIT_URL || 'amqp://admin:admin123@rabbitmq:5672';
const EXCHANGE   = 'atc.exchange';

let channel = null;

async function conectar(intentos = 10) {
  for (let i = 1; i <= intentos; i++) {
    try {
      const conn = await amqp.connect(RABBIT_URL);
      channel    = await conn.createChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      console.log(`[RabbitMQ-S1] Conectado → ${EXCHANGE}`);
      conn.on('error', () => { channel = null; });
      return channel;
    } catch {
      console.warn(`[RabbitMQ-S1] Intento ${i}/${intentos}. Reintentando en 3s...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw new Error('[RabbitMQ-S1] No se pudo conectar');
}

async function publicar(routingKey, data) {
  channel.publish(EXCHANGE, routingKey, Buffer.from(JSON.stringify(data)), { persistent: true });
  console.log(`[RabbitMQ-S1] Publicado → ${routingKey}`);
}

async function consumir(routingKey, queueName, handler) {
  const { queue } = await channel.assertQueue(queueName, { durable: true });
  await channel.bindQueue(queue, EXCHANGE, routingKey);
  channel.prefetch(1);
  channel.consume(queue, async (msg) => {
    if (!msg) return;
    try {
      const data = JSON.parse(msg.content.toString());
      console.log(`[RabbitMQ-S1] Recibido ← ${routingKey}`);
      await handler(data);
      channel.ack(msg);
    } catch (err) {
      console.error('[RabbitMQ-S1] Error:', err.message);
      channel.nack(msg, false, false);
    }
  });
  console.log(`[RabbitMQ-S1] Escuchando "${routingKey}"`);
}

module.exports = { conectar, publicar, consumir };

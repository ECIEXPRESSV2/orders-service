// Utilidad de prueba: publica un evento al exchange compartido.
// Uso: node scripts/publish-test-event.js <routingKey> <orderId> [reason]
require('dotenv').config();
const amqp = require('amqplib');
const { randomUUID } = require('crypto');

(async () => {
  const [routingKey, orderId, reason] = process.argv.slice(2);
  if (!routingKey || !orderId) {
    console.error('Uso: node scripts/publish-test-event.js <routingKey> <orderId> [reason]');
    process.exit(1);
  }
  const url = process.env.RABBITMQ_URL;
  const exchange = process.env.RABBITMQ_EXCHANGE || 'eciexpress_events';
  const conn = await amqp.connect(url);
  const ch = await conn.createChannel();
  await ch.assertExchange(exchange, 'topic', { durable: true });
  const payload = {
    orderId,
    idempotencyKey: randomUUID(),
    occurredAt: new Date().toISOString(),
    source: 'test-script',
    ...(reason ? { reason } : {}),
  };
  ch.publish(exchange, routingKey, Buffer.from(JSON.stringify(payload)), { persistent: true });
  console.log(`Publicado ${routingKey}:`, payload);
  await ch.close();
  await conn.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

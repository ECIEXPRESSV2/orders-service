// Utilidad de prueba: publica un evento al exchange compartido.
//
// Uso (compatible hacia atrás):
//   node scripts/publish-test-event.js <routingKey> <orderId> [reason]
// Uso con campos arbitrarios (para eventos que no usan orderId, p. ej. identity):
//   node scripts/publish-test-event.js identity.store.status_changed storeId=str_9 newStatus=CLOSED
//   node scripts/publish-test-event.js identity.user.deactivated userId=usr_456
//   node scripts/publish-test-event.js products.cart.priced cartId=<id> finalAmount=650000
//
// Reglas: los argumentos con `=` se agregan al payload como clave/valor; el primer
// argumento "suelto" (sin `=`) se toma como `orderId` y el segundo como `reason`.
require('dotenv').config();
const amqp = require('amqplib');
const { randomUUID } = require('crypto');

(async () => {
  const [routingKey, ...rest] = process.argv.slice(2);
  if (!routingKey) {
    console.error('Uso: node scripts/publish-test-event.js <routingKey> <orderId|clave=valor...> [reason]');
    process.exit(1);
  }

  const payload = {
    eventVersion: 1,
    source: 'test-script',
    correlationId: null,
    occurredAt: new Date().toISOString(),
    idempotencyKey: randomUUID(),
  };
  const bare = [];
  for (const arg of rest) {
    const eq = arg.indexOf('=');
    if (eq === -1) {
      bare.push(arg);
    } else {
      payload[arg.slice(0, eq)] = arg.slice(eq + 1);
    }
  }
  if (bare[0]) payload.orderId = bare[0];
  if (bare[1]) payload.reason = bare[1];

  const url = process.env.RABBITMQ_URL;
  const exchange = process.env.RABBITMQ_EXCHANGE || 'eciexpress_events';
  const conn = await amqp.connect(url);
  const ch = await conn.createChannel();
  await ch.assertExchange(exchange, 'topic', { durable: true });
  ch.publish(exchange, routingKey, Buffer.from(JSON.stringify(payload)), { persistent: true });
  console.log(`Publicado ${routingKey}:`, payload);
  await ch.close();
  await conn.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

# Event Catalog — orders-service (Order & Communication)

Exchange compartido: `eciexpress_events` (topic, `durable: true`)
Cola propia: `orders_service_queue`
Binding patterns (routing keys **exactas**, no comodines):
`financial.payment.processed`, `financial.payment.failed`,
`fulfillment.delivery.confirmed`, `fulfillment.delivery.failed`, `fulfillment.qr.expired`,
`products.cart.priced`, `products.return.priced`,
`identity.store.status_changed`, `identity.user.deactivated`

> ⚠️ A diferencia de otros servicios (que enlazan con comodines tipo `order.#`),
> orders-service enlaza con **routing keys exactas**. Si publican una key nueva de
> `financial.*`, `fulfillment.*`, `products.*` o `identity.*` que no esté en esta lista,
> **no la recibimos** hasta que la agreguemos a `CONSUMED_EVENTS`.

> Última alineación: 2026-06-21. Verificado contra el código de financial, fulfillment,
> products e identity (no contra sus PDF de catálogo, que estaban desactualizados).

---

## 1. Contrato del evento (el "sobre")

- **Transporte:** RabbitMQ (CloudAMQP).
- **Exchange:** `eciexpress_events` — tipo `topic`, `durable: true`.
- **Routing key:** formato `<servicio>.<entidad>.<accion>` (ej. `order.order.created`).
- **Cuerpo:** JSON **plano** (todos los campos al primer nivel). **No** se anida bajo `payload`.
- **Codificación:** `contentType: application/json`, mensajes `persistent: true`.

A **todo** evento que publicamos, el `OutboxService` le agrega automáticamente este sobre,
alineado con el sobre compartido de identity y fulfillment (mismos cinco metadatos):

| Campo | Tipo | Para qué |
|---|---|---|
| `eventVersion` | number | Versión del contrato del evento (hoy `1`). |
| `source` | string | Siempre `"orders-service"`. |
| `correlationId` | string (uuid) \| null | Trazabilidad entre servicios; `null` si el caso de uso no propaga uno. |
| `occurredAt` | string ISO‑8601 UTC | Momento en que se emitió. |
| `idempotencyKey` | string (uuid) | Evita reprocesar el mismo evento si el bus lo reentrega. |

> Los montos de dinero van en **centavos de COP** como entero. `650000` = $6.500.

---

## 2. Eventos publicados (salida)

La columna **Payload** lista los campos de negocio (sin contar el sobre del punto 1).

| Routing key | Cuándo se emite | Payload | Lo consume |
|---|---|---|---|
| `order.order.created` | Al crear un pedido (`POST /orders`) o al hacer checkout de un carrito | `{ orderId, buyerId, storeId, totalAmount, paymentMethod }` | financial (retiene el pago; lo omite si `paymentMethod==='cash'`), products (reserva stock), notifications |
| `order.order.status_changed` | En **cada** cambio de estado del pedido | `{ orderId, buyerId, status }` | notifications, reporting |
| `order.order.confirmed` | Cuando el pedido entra a `CONFIRMED` | `{ orderId, buyerId, storeId, pickupExpiresAt }` | fulfillment (genera el QR), products (consume la reserva de stock), notifications |
| `order.order.cancelled` | Cuando el pedido entra a `CANCELLED` | `{ orderId, buyerId }` | financial (reembolsa/libera retención), fulfillment (invalida el QR), products (libera la reserva), notifications |
| `order.chat.message.sent` | Al enviar un mensaje en el chat del pedido (`POST /messages`) | `{ messageId, conversationId, senderId, recipientId, preview }` | notifications |
| `order.cart.created` | Al crear un carrito (`POST /orders/draft`) **y** al inicio del `POST /orders` directo | `{ cartId, buyerId, storeId, currency }` | products (crea la proyección del carrito) |
| `order.cart.item_changed` | Al cambiar una línea del carrito (`POST /orders/:id/items`) **y** al crear un pedido directo | `{ cartId, storeId, currency, items: [{ productId, quantity }] }` | products (recotiza y responde `products.cart.priced`) |
| `order.return.requested` | Al solicitar una devolución (`POST /orders/:id/returns`) | `{ orderId, storeId, full, items?: [{ productId, quantity }], reason? }` | products (cotiza el reembolso) |
| `order.return.confirmed` | Tras aplicar `products.return.priced`: orders autoriza el reembolso | `{ orderId, buyerId, storeId, full, refundAmount }` | financial (acredita el reembolso → `financial.refund.issued`) |

> `cartId == orderId` **siempre**. products toma las cantidades de su proyección de
> carrito (`cartId`), no del payload de `order.order.*`. Por eso el `POST /orders` directo
> también emite `order.cart.created` + `order.cart.item_changed` antes de `order.order.created`:
> así products puede reservar stock en ambos flujos.

**Definición de routing keys:** [event-contracts.ts](../src/order-communication/infrastructure/messaging/event-contracts.ts)
**Dónde se publican:** [orders.service.ts](../src/order-communication/application/orders.service.ts) (pedidos, carrito, devoluciones), [communication.service.ts](../src/order-communication/application/communication.service.ts) (chat).

---

## 3. Eventos consumidos (entrada)

Order es el **único dueño** del estado del pedido: financial, fulfillment y products solo
publican; aquí se deciden las transiciones.

| Routing key | Trigger (qué hace) | Transición / efecto | Payload que usamos |
|---|---|---|---|
| `financial.payment.processed` | Pago retenido OK → se confirma el pedido | `PENDING_PAYMENT → PAYMENT_APPROVED → CONFIRMED` | `{ orderId* }` |
| `financial.payment.failed` | Falló el cobro → el pedido falla | `→ FAILED` | `{ orderId*, reason? }` |
| `fulfillment.delivery.confirmed` | Entrega confirmada → pedido entregado | `→ DELIVERED` | `{ orderId* }` |
| `fulfillment.delivery.failed` | Falló la entrega → el pedido falla | `→ FAILED` | `{ orderId*, reason? }` |
| `fulfillment.qr.expired` | Expiró el QR → se cancela (dispara reembolso) | `→ CANCELLED` | `{ orderId* }` |
| `products.cart.priced` | Cotización autoritativa del carrito | Aplica precios/promos al carrito `DRAFT` | `{ cartId*, lines[], subtotalAmount, discountAmount, finalAmount }` |
| `products.return.priced` | Monto de la devolución ya calculado | `→ RETURNED` / `PARTIALLY_RETURNED` + emite `order.return.confirmed` | `{ orderId*, full, refundAmount, lines[] }` |
| `identity.store.status_changed` | La tienda cambió de estado | Actualiza la proyección local; bloquea pedidos si `CLOSED`/`TEMPORARILY_CLOSED` | `{ storeId*, newStatus* }` |
| `identity.user.deactivated` | Usuario inactivado/suspendido | Revoca (desconecta) sus sesiones WebSocket | `{ userId* }` |

> Los campos con `*` son **obligatorios**. En los eventos con `orderId`, sin él se ignora.
> De `products.cart.priced` ignoramos campos extra (`listUnitPrice`, `appliedPromotionId`, …).
> **Manden siempre `idempotencyKey`** en los eventos con `orderId` para evitar doble procesamiento.
> Los eventos de products e identity se aplican siempre (son idempotentes por naturaleza:
> reemplazan una cotización, actualizan una proyección o revocan sesiones).

**Dónde se manejan:** [event-consumer.service.ts](../src/order-communication/infrastructure/messaging/event-consumer.service.ts)
**Acciones de dominio:** [orders.service.ts](../src/order-communication/application/orders.service.ts)

---

## 4. Cómo se publican: patrón Outbox transaccional

No publicamos directo a RabbitMQ desde la lógica de negocio. Usamos un **outbox** para
garantizar que ningún evento se pierda aunque el broker esté caído:

```
  Caso de uso                Tabla outbox_events           Worker (cada 5s)         RabbitMQ
  (orders.service)           (misma transacción)
 ┌──────────────┐           ┌──────────────────┐         ┌──────────────┐       ┌──────────────────┐
 │ events       │  guarda   │ status: PENDING  │  lee    │ OutboxWorker │ pub   │ eciexpress_events│
 │  .publish()  │ ────────► │ + sobre estándar │ ──────► │ publica y    │ ────► │ (topic, durable) │
 └──────────────┘           └──────────────────┘         │ marca        │       └──────────────────┘
                                                          │ PUBLISHED    │
                                                          └──────────────┘
```

1. La capa de aplicación llama a `EventPublisher.publish(routingKey, payload)`.
2. `OutboxService` guarda una fila en `outbox_events` con estado `PENDING` y el sobre
   estándar (sección 1) — en la **misma transacción** que el cambio de negocio.
3. `OutboxWorker` hace polling cada **5 s**, publica los `PENDING` a RabbitMQ y los marca
   `PUBLISHED`; si falla, reintenta hasta **5 veces** y luego los marca `FAILED`.
4. `RabbitMQService` publica al exchange `eciexpress_events` como mensaje persistente.

**Del lado de consumo**, `EventConsumerService` enlaza la cola `orders_service_queue` a las
9 routing keys de entrada y deduplica con la tabla `processed_events` (cada `idempotencyKey`
se procesa una sola vez en los eventos basados en `orderId`).

---

## 5. Ejemplos de payload (tal cual viajan en el bus)

```jsonc
// order.order.created
{
  "orderId": "7a2c1d4e-...", "buyerId": "usr_456", "storeId": "str_9",
  "totalAmount": 650000, "paymentMethod": "wallet",
  "eventVersion": 1, "source": "orders-service", "correlationId": null,
  "occurredAt": "2026-06-21T18:30:00.000Z", "idempotencyKey": "f0c1...-uuid"
}

// order.cart.item_changed
{ "cartId": "7a2c...", "storeId": "str_9", "currency": "COP",
  "items": [{ "productId": "p1", "quantity": 2 }], "eventVersion": 1, "source": "orders-service", "...": "..." }

// order.return.confirmed
{ "orderId": "7a2c...", "buyerId": "usr_456", "storeId": "str_9",
  "full": false, "refundAmount": 350000, "eventVersion": 1, "source": "orders-service", "...": "..." }
```

---

## 6. Cómo verificar que publicamos (para el equipo)

1. **Logs al arrancar** (`npm run start:dev`):
   `[RabbitMQService] Conectado a RabbitMQ; exchange 'eciexpress_events' listo`.
2. **Tabla `outbox_events`**: crea un pedido y consulta
   `SELECT routing_key, status, published_at FROM outbox_events ORDER BY created_at DESC;`
   — la fila pasa de `PENDING` a `PUBLISHED` en ~5 s.
3. **CloudAMQP:** crea una cola temporal con binding `order.#` y usa *Get messages*.
4. **Simular eventos entrantes** con el script de pruebas:
   ```bash
   node scripts/publish-test-event.js financial.payment.processed <orderId>
   node scripts/publish-test-event.js identity.store.status_changed <storeId>
   ```

---

## 7. Checklist para quien publique hacia orders-service

- [ ] Publico en el exchange `eciexpress_events` (topic, durable).
- [ ] Uso una de las 9 routing keys que **consumimos** (sección 3), exacta.
- [ ] El JSON va **plano**, con el identificador obligatorio (`orderId`/`cartId`/`storeId`/`userId`) al primer nivel.
- [ ] Incluyo `idempotencyKey` (uuid) en los eventos basados en `orderId`.
- [ ] En eventos de fallo, incluyo `reason` (texto) si quiero que quede en el historial.
- [ ] Montos (si aplican) en centavos de COP.

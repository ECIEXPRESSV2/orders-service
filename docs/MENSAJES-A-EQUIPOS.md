# Mensajes técnicos para otros equipos — desde Order & Communication

> Order & Communication ya está implementado, persistido (PostgreSQL/Neon), integrado a
> RabbitMQ (exchange compartido `eciexpress_events`) y autenticado vía identity (Firebase).
> Para cerrar la integración completa, los siguientes equipos deben hacer ajustes en **sus**
> repositorios. Order **no** modifica otros servicios: aquí va lo que necesitamos, justificado.

Estándar de eventos que Order ya cumple (referencia para todos):
- Routing key: `servicio.entidad.accion`
- Exchange topic compartido `eciexpress_events`, mensajes `persistent: true`
- Envelope plano en todo payload: `{ ...campos, idempotencyKey, occurredAt (ISO-8601 UTC), source }`
- Montos en **centavos COP** (enteros)

---

## 1) → FINANCIAL-SERVICE

**Contexto.**
Order ya publica `order.order.created` cuando se crea un pedido y `order.order.cancelled` al
cancelarlo. Hoy financial retiene (HELD) el pago de la billetera ante **cualquier**
`order.order.created`. Pero un pedido puede ser en **efectivo** (`paymentMethod: 'cash'`), donde
**no** debe retenerse saldo de la billetera.

**Cambio requerido.**
Al consumir `order.order.created`, **omitir la retención cuando `paymentMethod === 'cash'`**.
Para facilitarlo, Order ya incluye el campo `paymentMethod` en el payload del evento.

**Motivación.**
Si financial retiene saldo para pedidos en efectivo, descuadra la billetera del comprador por
dinero que pagará físicamente en la tienda. Order es el dueño del ciclo de pago digital, pero la
retención/cobro lo ejecuta financial; necesitamos que respete el método de pago.

**Contrato esperado (consumido por financial, sin cambios salvo leer `paymentMethod`).**
`order.order.created`
```json
{
  "orderId": "uuid",
  "buyerId": "uuid",
  "storeId": "uuid",
  "totalAmount": 650000,
  "paymentMethod": "wallet | cash | card | transfer",
  "idempotencyKey": "uuid",
  "occurredAt": "2026-06-19T14:00:00.000Z",
  "source": "orders-service"
}
```

**Impacto técnico.**
Sin el cambio, los pedidos en efectivo generan retenciones indebidas. Order continuará
publicando `paymentMethod`; basta con un `if` en el consumer de financial.

**Confirmaciones de contrato (ya alineadas, no requieren cambio):**
- Order **consume** `financial.payment.processed` y `financial.payment.failed`. Solo usamos
  `orderId` (y `reason` en el failed). Manténganlos en el payload.
- Order **publica** `order.order.cancelled { orderId, buyerId, idempotencyKey, occurredAt }` para
  disparar el reembolso. Financial solo necesita `orderId`. ✔️

**Prioridad: ALTA.**

---

## 2) → PRODUCTS-SERVICE

**Contexto.**
Al crear un pedido, Order debe validar que cada producto **exista**, **pertenezca a la tienda**,
esté **disponible** y usar el **precio autoritativo** del catálogo. Hoy products-service solo
expone `categories`; no hay endpoint de productos, por lo que Order usa un **mock** que confía en
el precio que envía el cliente (riesgo de manipulación de precios).

**Cambio requerido.**
Exponer un endpoint de consulta de productos por IDs y tienda.

**Contrato esperado.**
```
GET /products?storeId={uuid}&ids=uuid1,uuid2
```

**Payload esperado (respuesta).**
```json
[
  {
    "id": "uuid",
    "storeId": "uuid",
    "name": "Capuccino",
    "price": 650000,          // centavos COP, precio autoritativo
    "currency": "COP",
    "isAvailable": true,
    "stock": 12               // opcional; si viene, Order valida cantidad <= stock
  }
]
```

**Motivación.**
El precio no puede ser fuente de verdad del cliente: un comprador podría enviar `unitPrice: 1`.
Order debe tomar el precio del catálogo. También evita vender productos inexistentes o de otra
tienda.

**Impacto técnico.**
Order ya tiene el cliente real implementado ([products-http.client.ts](../src/order-communication/infrastructure/clients/products-http.client.ts))
y se activa con `USE_PRODUCTS_MOCK=false`. Mientras no exista el endpoint, Order opera en modo
mock (precio del cliente). En cuanto publiquen el endpoint con este contrato, cambiamos el flag y
queda integrado sin más cambios.

**Prioridad: ALTA.**

---

## 3) → FULFILLMENT-SERVICE (servicio aún inexistente)

**Contexto.**
Order es el **único dueño del estado del pedido**. Fulfillment gestiona el QR de recogida y la
entrega, pero **no** modifica estados de Order directamente: publica eventos y Order decide las
transiciones. Order ya consume estos eventos y ya publica el evento que fulfillment necesita.

**Cambio requerido.**
Crear el servicio y, sobre el exchange compartido `eciexpress_events`:
- **Consumir** `order.order.confirmed` (incluye `pickupExpiresAt`) para generar el QR y fijar la
  ventana de recogida.
- **Publicar** los eventos de entrega/expiración.

**Contrato que Order YA ofrece (publicado).**
`order.order.confirmed`
```json
{
  "orderId": "uuid",
  "buyerId": "uuid",
  "storeId": "uuid",
  "pickupExpiresAt": "2026-06-19T16:00:00.000Z",
  "idempotencyKey": "uuid",
  "occurredAt": "2026-06-19T14:00:00.000Z",
  "source": "orders-service"
}
```
> Nota: corregimos una inconsistencia previa donde algunos consumidores solo esperaban
> `{ orderId, buyerId }`. El contrato definitivo de `order.order.confirmed` **incluye
> `pickupExpiresAt`** porque fulfillment lo necesita para la expiración del QR.

**Contratos que Order espera CONSUMIR (deben publicar así).**
```
fulfillment.delivery.confirmed   { orderId, idempotencyKey, occurredAt }       -> Order: DELIVERED
fulfillment.delivery.failed      { orderId, reason, idempotencyKey, occurredAt } -> Order: FAILED
fulfillment.qr.expired           { orderId, idempotencyKey, occurredAt }        -> Order: CANCELLED (dispara reembolso)
```

**Motivación.**
Permite cerrar el ciclo (entrega real, fallos y expiración de QR) manteniendo a Order como única
fuente de verdad del estado y a financial reaccionando (liberación/reembolso) a estos eventos.

**Impacto técnico.**
Order ya consume estas tres routing keys de forma **idempotente**
([event-consumer.service.ts](../src/order-communication/infrastructure/messaging/event-consumer.service.ts)).
Mientras fulfillment no exista, probamos publicando estos eventos manualmente
([scripts/publish-test-event.js](../scripts/publish-test-event.js)). No bloquea a Order.

**Prioridad: MEDIA** (no bloquea el desarrollo de Order, pero es necesario para producción).

---

## 4) → IDENTITY-SERVICE (opcional / mejora)

**Contexto.**
El chat por pedido (RF-09) crea una conversación comprador–vendedor. Conocemos al comprador
(`buyerId`, del token) y la tienda (`storeId`), pero **no** el `userId` del vendedor/staff de la
tienda. Hoy aproximamos `vendorId = storeId`.

**Cambio requerido (opcional).**
Exponer el/los usuarios responsables (staff) de una tienda, por ejemplo:
```
GET /internal/stores/{storeId}/staff  -> [{ userId, role }]
```

**Motivación.**
Para que el vendedor real reciba notificaciones y aparezca correctamente como participante del
chat (en vez de usar el `storeId` como marcador).

**Impacto técnico.**
Bajo. Order ya funciona con la aproximación actual; con este endpoint, mejoramos `vendorId`.

**Prioridad: BAJA.**

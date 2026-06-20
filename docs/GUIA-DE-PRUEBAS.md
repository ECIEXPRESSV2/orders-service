# Guía de pruebas — Order & Communication (ECIXPRESS)

Esta guía explica **paso a paso** cómo probar el backend (`orders-service`) y el frontend, qué
escribir, dónde mirar y qué debería salir.

Credenciales de prueba (todas con contraseña `Admin12345`):
- `buyer@prueba.com` (comprador) ← **usa esta para casi todo**
- `vendor@prueba.com`, `analyst@prueba.com`, `admin@prueba.com`

Infra ya configurada en `.env`: PostgreSQL (Neon) y RabbitMQ (CloudAMQP compartido), identity en
Render. No necesitas levantar Docker; todo apunta a la nube.

---

## PARTE A — BACKEND (orders-service)

### A.1 Preparar y levantar

```bash
cd orders-service
npm install            # solo la primera vez
npm run migration:run  # crea las tablas en Neon (idempotente; si ya están, no hace nada)
npm run start:dev      # levanta en http://localhost:3000
```

**Qué deberías ver** en consola: rutas mapeadas y, al final:
```
[RabbitMQService] Conectado a RabbitMQ; exchange 'eciexpress_events' listo
[RabbitMQService] Consumiendo 'orders_service_queue' con bindings: fulfillment.delivery.confirmed, ... financial.payment.failed
[NestApplication] Nest application successfully started
```

### A.2 Swagger (documentación viva)

Abre **http://localhost:3000/api**. Deberías ver los grupos **Orders**, **Conversations**,
**Messages** con todos los endpoints y el botón **Authorize** (Bearer). El candado indica que
requieren token.

> `GET /health` es público: http://localhost:3000/health → `{"status":"ok",...}`.

### A.3 Obtener un token Firebase real (para endpoints protegidos)

Los endpoints exigen `Authorization: Bearer <idToken>`. Para obtener el token del comprador:

```bash
curl -s -X POST \
 "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyDtp45QcbFkXk9H6pE_2pmq3Nmq6TxxkHA" \
 -H 'Content-Type: application/json' \
 -d '{"email":"buyer@prueba.com","password":"Admin12345","returnSecureToken":true}' \
 | python3 -c 'import sys,json;print(json.load(sys.stdin)["idToken"])'
```

Copia el valor y guárdalo:
```bash
export TK="<pega-el-idToken-aqui>"
```
> El token dura 1 hora. Si ves 401, vuelve a generarlo.

En Swagger: clic en **Authorize**, pega el token (sin la palabra "Bearer") y listo.

### A.4 Probar los endpoints (con `curl`)

**1) Sin token → 401 (seguridad):**
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/orders     # 401
```

**2) Crear pedido (con token). Montos en CENTAVOS COP:**
```bash
curl -s -X POST http://localhost:3000/orders \
 -H "Authorization: Bearer $TK" -H 'Content-Type: application/json' \
 -d '{
   "storeId":"7a2c1d4e-3b5f-4a6c-8d9e-1f2a3b4c5d6e",
   "storeName":"Café Central",
   "items":[{"productId":"9f8e7d6c-5b4a-4938-8271-6051403f2e1d","name":"Capuccino","unitPrice":650000,"quantity":1}],
   "paymentMethod":"wallet","deliveryMethod":"pickup","currency":"COP"
 }'
```
**Qué debe salir:** un JSON con `"status":"PENDING_PAYMENT"`, `"customerId"` = tu userId de
identity (NO lo que mandes en el body: lo toma del token), `"totalAmount":650000`, y
`statusHistory` con `CREATED → PENDING_PAYMENT`. Copia el `id` del pedido → `export OID=<id>`.

> Si usas `"paymentMethod":"cash"` el pedido queda directo en `CONFIRMED`.

**3) Validación (body inválido) → 400:**
```bash
curl -s -X POST http://localhost:3000/orders -H "Authorization: Bearer $TK" \
 -H 'Content-Type: application/json' -d '{"storeId":"x","items":[]}'
```
**Debe salir:** `400` con lista de mensajes (`storeId must be a UUID`, `items must contain at
least 1 elements`, etc.).

**4) Listar / detalle / historial:**
```bash
curl -s "http://localhost:3000/orders" -H "Authorization: Bearer $TK"
curl -s "http://localhost:3000/orders/$OID" -H "Authorization: Bearer $TK"
curl -s "http://localhost:3000/orders/history" -H "Authorization: Bearer $TK"
```

**5) Chat: la conversación se crea sola al crear el pedido.**
```bash
curl -s "http://localhost:3000/conversations?orderId=$OID" -H "Authorization: Bearer $TK"
# copia el id de la conversación -> export CID=<id>
curl -s -X POST http://localhost:3000/messages -H "Authorization: Bearer $TK" \
 -H 'Content-Type: application/json' \
 -d "{\"conversationId\":\"$CID\",\"senderRole\":\"customer\",\"content\":\"Hola, ¿está listo?\"}"
curl -s "http://localhost:3000/messages?conversationId=$CID" -H "Authorization: Bearer $TK"
```
**Debe salir:** el mensaje con `senderId` = tu userId real, y el listado con `total` creciente.

### A.5 Probar eventos RabbitMQ (integración real)

Order **publica** eventos (outbox → CloudAMQP) y **consume** eventos de financial/fulfillment.
Para simular esos eventos entrantes hay un script:

**Simular pago aprobado → el pedido pasa a CONFIRMED:**
```bash
node scripts/publish-test-event.js financial.payment.processed $OID
# espera ~2s y consulta:
curl -s "http://localhost:3000/orders/$OID" -H "Authorization: Bearer $TK"
```
**Debe salir:** `status` = `CONFIRMED`, con historial `... → PAYMENT_APPROVED → CONFIRMED` y
`pickupExpiresAt` con fecha. En la consola del servicio verás `Evento aplicado:
financial.payment.processed`.

**Simular entrega (debe estar en READY_FOR_PICKUP primero):**
```bash
curl -s -X PATCH http://localhost:3000/orders/$OID/status -H "Authorization: Bearer $TK" \
 -H 'Content-Type: application/json' -d '{"status":"IN_PREPARATION","actorType":"vendor"}'
curl -s -X PATCH http://localhost:3000/orders/$OID/status -H "Authorization: Bearer $TK" \
 -H 'Content-Type: application/json' -d '{"status":"READY_FOR_PICKUP","actorType":"vendor"}'
node scripts/publish-test-event.js fulfillment.delivery.confirmed $OID
# consulta -> status DELIVERED
```

**Otros eventos consumidos que puedes probar igual:**
- `financial.payment.failed` → `FAILED`
- `fulfillment.delivery.failed` → `FAILED`
- `fulfillment.qr.expired` → `CANCELLED` (dispara reembolso en financial)

**Calificar (RF-10) tras DELIVERED:**
```bash
curl -s -X POST http://localhost:3000/orders/$OID/rating -H "Authorization: Bearer $TK" \
 -H 'Content-Type: application/json' -d '{"score":5,"comment":"Excelente"}'
```

**¿Dónde ver que Order PUBLICÓ sus eventos?** En el panel de CloudAMQP (RabbitMQ Management) →
exchange `eciexpress_events`, o pregúntale al equipo de **notifications**: cada acción genera
`order.order.created/status_changed/confirmed/...` que ellos consumen. También puedes inspeccionar
la tabla `outbox_events` en Neon: las filas pasan de `PENDING` a `PUBLISHED`.

### A.6 Tests automáticos

```bash
npm test
```
**Debe salir:** `Test Suites: 4 passed`, `Tests: 19 passed`.

---

## PARTE B — FRONTEND

### B.1 Configurar y levantar

Asegúrate de que el `.env` del frontend tenga (apuntando al orders-service local):
```
VITE_ORDERS_SERVICE_URL=http://localhost:3000
VITE_API_URL=https://identity-service-wcoy.onrender.com/
# (las VITE_FIREBASE_* ya están)
```

```bash
cd frontend/ecixpress
npm install        # primera vez
npm run dev        # http://localhost:5173
```

> Mantén el backend (`orders-service`) corriendo en paralelo (Parte A.1).

### B.2 Iniciar sesión

1. Abre **http://localhost:5173**.
2. Clic en iniciar sesión → entra con **buyer@prueba.com** / **Admin12345**.
3. Llegas a `/home`. A la izquierda está la **barra lateral**; al pasar el mouse se expande.

### B.3 Pedidos, seguimiento, reordenar, cancelar (RF-07, RF-08, RF-10)

1. En la barra lateral, clic en **Pedidos** (ícono de portapapeles) → vas a `/orders`.
2. Arriba a la derecha verás el indicador **"En vivo"** (verde) = WebSocket conectado.
3. Clic en **Nuevo pedido**. Se abre un modal:
   - Tienda: `Café Central` (o lo que quieras)
   - Store ID: viene un UUID prellenado (déjalo)
   - Producto: `Capuccino`, Precio (COP): `6500`, Cantidad: `1`
   - Método de pago: **Billetera**
   - Clic **Crear pedido**.
4. **Qué debe pasar:** aparece el pedido en la lista con estado **"Pago pendiente"**. Al
   seleccionarlo, a la derecha ves el **detalle**, los **productos** (precio formateado `$6.500`),
   el **total**, y la **línea de seguimiento** (Creado → Pago pendiente → … → Entregado).
5. **Seguimiento en tiempo real (RF-08):** con la página abierta, en otra terminal ejecuta
   `node scripts/publish-test-event.js financial.payment.processed <id-del-pedido>`
   (el `<id>` está en la URL del chat o puedes verlo en el backend). **Sin recargar**, el estado
   del pedido cambia solo a **"Confirmado"** y la línea de seguimiento avanza. ✨
6. **Reordenar:** botón **Reordenar** crea un pedido nuevo idéntico.
7. **Cancelar:** botón **Cancelar** (visible si el pedido no está entregado/cancelado) → pasa a
   "Cancelado".
8. **Calificar (RF-10):** cuando el pedido esté en "Listo para recoger" o "Entregado", aparece el
   botón **Calificar** → abre un modal de estrellas + comentario → se guarda y se muestra.

### B.4 Chat comprador–vendedor (RF-09)

1. En el detalle de un pedido, clic en **Chat con la tienda** → vas a `/messages` con esa
   conversación seleccionada. (También entras desde la barra lateral → **Mensajes**.)
2. Escribe un mensaje y **Enter** o el botón enviar. Aparece a la derecha (burbuja amarilla).
3. **Tiempo real:** abre la misma conversación en **otra pestaña** (o el indicador "escribiendo…")
   y verás los mensajes aparecer en vivo en ambas. El indicador **"En vivo"** debe estar verde.

### B.5 Qué validar en conjunto

| Requisito | Dónde | Qué confirmar |
|---|---|---|
| RF-07 Crear pedido | /orders → Nuevo pedido | Se crea y aparece en la lista |
| RF-08 Estado en tiempo real | /orders, detalle | El estado cambia solo al publicar eventos |
| RF-09 Chat por pedido | /messages | Enviar/recibir mensajes en vivo |
| RF-10 Historial + calificar | /orders | Lista histórica + modal de calificación |
| Seguridad | cualquier acción | Sin sesión no entra; el `customerId` sale del token |

---

## Solución de problemas

- **401 en el backend:** el token expiró (dura 1h). Genera otro (A.3).
- **El frontend no carga pedidos:** verifica que `orders-service` esté corriendo y que
  `VITE_ORDERS_SERVICE_URL=http://localhost:3000`.
- **"Sin conexión" (WebSocket) en gris:** revisa que el backend esté arriba; el socket usa el
  mismo token Firebase.
- **identity lento la primera vez:** está en Render (plan gratuito) y "despierta" en ~30-50s en la
  primera petición; luego va rápido.
- **La tienda no valida disponibilidad:** es normal en pruebas; si identity no responde, Order
  **no bloquea** el pedido (degradación elegante) y lo registra como advertencia.
- **Precios:** se guardan y viajan en **centavos** (650000 = $6.500). El frontend formatea con
  `formatCOP`.

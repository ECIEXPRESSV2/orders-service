/**
 * Contratos de eventos de Order & Communication sobre el exchange compartido
 * `eciexpress_events` (topic). Routing key: `servicio.entidad.accion`.
 *
 * Envelope estándar (lo agrega el OutboxService a TODO payload):
 *   { ...payload, eventVersion, source: 'orders-service', correlationId, occurredAt (ISO-8601 UTC), idempotencyKey }
 * Alineado con el sobre compartido de identity/fulfillment (mismos cinco metadatos).
 */

export const EVENT_SOURCE = 'orders-service';

// ─── Routing keys que PUBLICA orders-service ────────────────────
export const ORDER_EVENTS = {
  CREATED: 'order.order.created',
  CONFIRMED: 'order.order.confirmed',
  CANCELLED: 'order.order.cancelled',
  READY_FOR_PICKUP: 'order.order.ready_for_pickup',
  STATUS_CHANGED: 'order.order.status_changed',
  CHAT_MESSAGE_SENT: 'order.chat.message.sent',
  // Carrito (orden DRAFT) y devoluciones: products-service los consume.
  CART_CREATED: 'order.cart.created',
  CART_ITEM_CHANGED: 'order.cart.item_changed',
  RETURN_REQUESTED: 'order.return.requested',
  // orders autoriza el reembolso con el monto que cotizó products; financial lo ejecuta.
  RETURN_CONFIRMED: 'order.return.confirmed',
} as const;

// ─── Routing keys que CONSUME orders-service ────────────────────
export const CONSUMED_EVENTS = {
  DELIVERY_CONFIRMED: 'fulfillment.delivery.confirmed',
  DELIVERY_FAILED: 'fulfillment.delivery.failed',
  QR_EXPIRED: 'fulfillment.qr.expired',
  PAYMENT_PROCESSED: 'financial.payment.processed',
  PAYMENT_FAILED: 'financial.payment.failed',
  // products-service responde con la cotización del carrito y de la devolución.
  CART_PRICED: 'products.cart.priced',
  RETURN_PRICED: 'products.return.priced',
  // identity-service: orders reacciona para bloquear pedidos y revocar sesiones.
  STORE_STATUS_CHANGED: 'identity.store.status_changed',
  USER_DEACTIVATED: 'identity.user.deactivated',
  // products-service: la reserva de stock para una línea de la orden falló.
  RESERVATION_REJECTED: 'product.inventory.reservation_rejected',
  // products-service: se reservó stock para TODAS las líneas → los pedidos en efectivo
  // pueden confirmarse (recién con stock realmente reservado).
  RESERVATION_CONFIRMED: 'product.inventory.reservation_confirmed',
} as const;

export const CONSUMED_ROUTING_KEYS: string[] = Object.values(CONSUMED_EVENTS);

// ─── Payloads publicados ────────────────────────────────────────
export interface OrderCreatedPayload {
  orderId: string;
  buyerId: string;
  storeId: string;
  /** Valor de los productos (base del pedido), centavos COP. Base para la comisión de plataforma. */
  orderAmount: number;
  /** Recargo de hora pico que paga el comprador, centavos COP (0 si no aplica). Fijado en el checkout. */
  peakFeeAmount: number;
  /** true si el checkout cayó en hora pico. */
  isPeakHour: boolean;
  /** Total a cobrar = orderAmount + peakFeeAmount, centavos COP. Es el precio de la orden. */
  totalAmount: number;
  paymentMethod: string;
}

export interface OrderConfirmedPayload {
  orderId: string;
  orderNumber: string;
  buyerId: string;
  storeId: string;
  pickupExpiresAt: string; // ISO-8601 UTC
}

export interface OrderCancelledPayload {
  orderId: string;
  buyerId: string;
  /** true si la orden ya había sido CONFIRMED (o más allá): el stock físico ya
   *  se había descontado y products-service debe restituirlo, no solo liberar
   *  una reserva. */
  wasSold: boolean;
  /**
   * Política de reembolso para financial-service. Ausente = reembolso del 100% (comportamiento
   * histórico, para cancelaciones no cubiertas por las reglas nuevas). 'HALF_PRODUCTS_ONLY' =
   * cancelación del cliente antes de listo-para-retirar (50% de productos, pierde la hora
   * pico). 'NO_REFUND' = venció el QR (el negocio ya preparó el pedido, se le paga completo).
   */
  refundPolicy?: 'HALF_PRODUCTS_ONLY' | 'NO_REFUND';
}

export interface OrderStatusChangedPayload {
  orderId: string;
  buyerId: string;
  status: string;
}

export interface ChatMessageSentPayload {
  messageId: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  preview: string;
}

// ─── Payloads consumidos (campos que usamos) ────────────────────
export interface IncomingEventEnvelope {
  idempotencyKey?: string;
  occurredAt?: string;
  orderId?: string;
  reason?: string;
  [key: string]: unknown;
}

/** Payload de `products.cart.priced`: cotización autoritativa del carrito. */
export interface IncomingCartPricedLine {
  productId: string;
  name: string;
  imageUrl?: string;
  unitPrice: number; // centavos COP
  quantity: number;
  totalAmount: number; // centavos COP
}

export interface IncomingCartPricedEvent {
  cartId: string;
  storeId: string;
  currency?: string;
  lines: IncomingCartPricedLine[];
  subtotalAmount: number;
  discountAmount: number;
  finalAmount: number;
}

/** Payload de `products.return.priced`: monto a devolver ya calculado. */
export interface IncomingReturnPricedEvent {
  orderId: string;
  storeId: string;
  full: boolean;
  refundAmount: number; // centavos COP
  lines: Array<{ productId: string; quantity: number; amount: number }>;
}

/** Estados de tienda que publica identity en `identity.store.status_changed`. */
export type IncomingStoreStatus = 'OPEN' | 'CLOSED' | 'TEMPORARILY_CLOSED';

/** Payload de `identity.store.status_changed`: cambio de estado de un punto de venta. */
export interface IncomingStoreStatusChangedEvent {
  storeId: string;
  previousStatus?: IncomingStoreStatus;
  newStatus: IncomingStoreStatus;
  reason?: string;
}

/** Payload de `identity.user.deactivated`: usuario inactivado o suspendido. */
export interface IncomingUserDeactivatedEvent {
  userId: string;
  reason?: string;
}

/** Payload de `product.inventory.reservation_rejected`: no había stock para reservar una línea. */
export interface IncomingReservationRejectedEvent {
  orderId: string;
  productId: string;
  storeId: string;
  requestedQuantity: number;
  availableQuantity: number;
  reason: string;
}

/** Payload de `product.inventory.reservation_confirmed`: se reservó stock de todas las líneas. */
export interface IncomingReservationConfirmedEvent {
  orderId: string;
  storeId: string;
}

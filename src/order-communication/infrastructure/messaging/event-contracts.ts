/**
 * Contratos de eventos de Order & Communication sobre el exchange compartido
 * `eciexpress_events` (topic). Routing key: `servicio.entidad.accion`.
 *
 * Envelope estándar (lo agrega el OutboxService a TODO payload):
 *   { ...payload, idempotencyKey, occurredAt (ISO-8601 UTC), source: 'orders-service' }
 */

export const EVENT_SOURCE = 'orders-service';

// ─── Routing keys que PUBLICA orders-service ────────────────────
export const ORDER_EVENTS = {
  CREATED: 'order.order.created',
  CONFIRMED: 'order.order.confirmed',
  CANCELLED: 'order.order.cancelled',
  STATUS_CHANGED: 'order.order.status_changed',
  CHAT_MESSAGE_SENT: 'order.chat.message.sent',
} as const;

// ─── Routing keys que CONSUME orders-service ────────────────────
export const CONSUMED_EVENTS = {
  DELIVERY_CONFIRMED: 'fulfillment.delivery.confirmed',
  DELIVERY_FAILED: 'fulfillment.delivery.failed',
  QR_EXPIRED: 'fulfillment.qr.expired',
  PAYMENT_PROCESSED: 'financial.payment.processed',
  PAYMENT_FAILED: 'financial.payment.failed',
} as const;

export const CONSUMED_ROUTING_KEYS: string[] = Object.values(CONSUMED_EVENTS);

// ─── Payloads publicados ────────────────────────────────────────
export interface OrderCreatedPayload {
  orderId: string;
  buyerId: string;
  storeId: string;
  totalAmount: number; // centavos COP
  paymentMethod: string;
}

export interface OrderConfirmedPayload {
  orderId: string;
  buyerId: string;
  storeId: string;
  pickupExpiresAt: string; // ISO-8601 UTC
}

export interface OrderCancelledPayload {
  orderId: string;
  buyerId: string;
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

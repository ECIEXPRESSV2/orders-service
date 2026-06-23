export type OrderStatus =
  | 'DRAFT'
  | 'CREATED'
  | 'PENDING_PAYMENT'
  | 'PAYMENT_APPROVED'
  | 'CONFIRMED'
  | 'IN_PREPARATION'
  | 'READY_FOR_PICKUP'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'FAILED'
  | 'PARTIALLY_RETURNED'
  | 'RETURNED';

export type OrderActorType = 'customer' | 'vendor' | 'system' | 'payment' | 'fulfillment';
export type OrderPaymentMethod = 'cash' | 'wallet' | 'card' | 'transfer';
export type OrderDeliveryMethod = 'pickup' | 'delivery';
export type OrderSource = 'web' | 'mobile' | 'admin';

// Listas de valores permitidos, reutilizadas por los validadores de DTOs.
export const ORDER_STATUS_VALUES: OrderStatus[] = [
  'DRAFT', 'CREATED', 'PENDING_PAYMENT', 'PAYMENT_APPROVED', 'CONFIRMED',
  'IN_PREPARATION', 'READY_FOR_PICKUP', 'DELIVERED', 'CANCELLED', 'FAILED',
  'PARTIALLY_RETURNED', 'RETURNED',
];
export const ORDER_ACTOR_TYPES: OrderActorType[] = ['customer', 'vendor', 'system', 'payment', 'fulfillment'];
export const ORDER_PAYMENT_METHODS: OrderPaymentMethod[] = ['cash', 'wallet', 'card', 'transfer'];
export const ORDER_DELIVERY_METHODS: OrderDeliveryMethod[] = ['pickup', 'delivery'];
export const ORDER_SOURCES: OrderSource[] = ['web', 'mobile', 'admin'];

export interface OrderItem {
  id: string;
  /** UUID del producto en products-service. */
  productId: string;
  name: string;
  description?: string;
  imageUrl?: string;
  /** Observación del comprador para esta línea (ej. "sin cebolla"). */
  notes?: string;
  /** Precio unitario en centavos COP (entero). */
  unitPrice: number;
  quantity: number;
  /** unitPrice * quantity, en centavos COP. */
  totalAmount: number;
}

export interface OrderStatusHistory {
  id: string;
  orderId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actorType: OrderActorType;
  actorId?: string;
  reason?: string;
  occurredAt: string;
}

export interface OrderRating {
  id: string;
  orderId: string;
  customerId: string;
  score: number;
  comment?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  /** UUID del comprador (userId de identity-service). */
  customerId: string;
  /** UUID de la tienda (storeId de identity-service). */
  storeId: string;
  storeName: string;
  status: OrderStatus;
  paymentMethod: OrderPaymentMethod;
  deliveryMethod: OrderDeliveryMethod;
  currency: string;
  source: OrderSource;
  notes?: string;
  /** Clave de idempotencia del request de creación (evita pedidos duplicados). */
  idempotencyKey?: string;
  /** ISO-8601 UTC: hora de recogida programada por el comprador (opcional). */
  scheduledPickupAt?: string;
  /** Montos en centavos COP (enteros). */
  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
  items: OrderItem[];
  statusHistory: OrderStatusHistory[];
  rating?: OrderRating;
  /** ISO-8601 UTC: hasta cuándo el pedido puede recogerse (se fija al pasar a READY_FOR_PICKUP). */
  pickupExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string;
  deletedAt?: string;
}

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  // DRAFT es el carrito: acumula ítems hasta el checkout, que lo lleva a pago.
  DRAFT: ['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'FAILED'],
  CREATED: ['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'FAILED'],
  PENDING_PAYMENT: ['PAYMENT_APPROVED', 'CANCELLED', 'FAILED'],
  PAYMENT_APPROVED: ['CONFIRMED', 'CANCELLED', 'FAILED'],
  CONFIRMED: ['IN_PREPARATION', 'CANCELLED', 'FAILED', 'PARTIALLY_RETURNED', 'RETURNED'],
  IN_PREPARATION: ['READY_FOR_PICKUP', 'FAILED'],
  READY_FOR_PICKUP: ['DELIVERED', 'FAILED', 'PARTIALLY_RETURNED', 'RETURNED'],
  DELIVERED: ['PARTIALLY_RETURNED', 'RETURNED'],
  // Una devolución parcial admite devoluciones adicionales hasta completarse.
  PARTIALLY_RETURNED: ['PARTIALLY_RETURNED', 'RETURNED'],
  RETURNED: [],
  CANCELLED: [],
  FAILED: ['CANCELLED'],
};

export const canTransitionOrder = (fromStatus: OrderStatus, toStatus: OrderStatus): boolean =>
  ORDER_TRANSITIONS[fromStatus].includes(toStatus);

export const createHistoryEntry = (params: {
  orderId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actorType: OrderActorType;
  actorId?: string;
  reason?: string;
}): OrderStatusHistory => ({
  id: crypto.randomUUID(),
  orderId: params.orderId,
  fromStatus: params.fromStatus,
  toStatus: params.toStatus,
  actorType: params.actorType,
  actorId: params.actorId,
  reason: params.reason,
  occurredAt: new Date().toISOString(),
});

export const calculateAmounts = (items: Array<Pick<OrderItem, 'unitPrice' | 'quantity'>>, discountAmount = 0) => {
  const subtotalAmount = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  return {
    subtotalAmount,
    totalAmount: Math.max(0, subtotalAmount - discountAmount),
  };
};

export const transitionOrder = (
  order: Order,
  params: {
    toStatus: OrderStatus;
    actorType: OrderActorType;
    actorId?: string;
    reason?: string;
  },
): Order => {
  if (!canTransitionOrder(order.status, params.toStatus)) {
    throw new Error(`Invalid transition from ${order.status} to ${params.toStatus}`);
  }

  const occurredAt = new Date().toISOString();
  return {
    ...order,
    status: params.toStatus,
    statusHistory: [
      ...order.statusHistory,
      {
        id: crypto.randomUUID(),
        orderId: order.id,
        fromStatus: order.status,
        toStatus: params.toStatus,
        actorType: params.actorType,
        actorId: params.actorId,
        reason: params.reason,
        occurredAt,
      },
    ],
    updatedAt: occurredAt,
    cancelledAt: params.toStatus === 'CANCELLED' ? occurredAt : order.cancelledAt,
  };
};

export const attachRating = (order: Order, rating: OrderRating): Order => ({
  ...order,
  rating,
  updatedAt: rating.updatedAt,
});
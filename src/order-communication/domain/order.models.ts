export type OrderStatus =
  | 'CREATED'
  | 'PENDING_PAYMENT'
  | 'PAYMENT_APPROVED'
  | 'CONFIRMED'
  | 'IN_PREPARATION'
  | 'READY_FOR_PICKUP'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'FAILED';

export type OrderActorType = 'customer' | 'vendor' | 'system' | 'payment' | 'fulfillment';
export type OrderPaymentMethod = 'cash' | 'wallet' | 'card' | 'transfer';
export type OrderDeliveryMethod = 'pickup' | 'delivery';
export type OrderSource = 'web' | 'mobile' | 'admin';

export interface OrderItem {
  id: string;
  productId: number;
  name: string;
  description?: string;
  imageUrl?: string;
  unitPrice: number;
  quantity: number;
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
  customerId: string;
  storeId: number;
  storeName: string;
  status: OrderStatus;
  paymentMethod: OrderPaymentMethod;
  deliveryMethod: OrderDeliveryMethod;
  currency: string;
  source: OrderSource;
  notes?: string;
  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
  items: OrderItem[];
  statusHistory: OrderStatusHistory[];
  rating?: OrderRating;
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string;
  deletedAt?: string;
}

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  CREATED: ['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'FAILED'],
  PENDING_PAYMENT: ['PAYMENT_APPROVED', 'CANCELLED', 'FAILED'],
  PAYMENT_APPROVED: ['CONFIRMED', 'CANCELLED', 'FAILED'],
  CONFIRMED: ['IN_PREPARATION', 'CANCELLED', 'FAILED'],
  IN_PREPARATION: ['READY_FOR_PICKUP', 'FAILED'],
  READY_FOR_PICKUP: ['DELIVERED', 'FAILED'],
  DELIVERED: [],
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
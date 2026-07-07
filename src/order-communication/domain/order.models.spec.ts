import {
  attachRating,
  calculateAmounts,
  canTransitionOrder,
  createHistoryEntry,
  Order,
  transitionOrder,
} from './order.models';

const baseOrder = (): Order => ({
  id: 'o1',
  orderNumber: 'OC-1',
  customerId: 'c1',
  storeId: 's1',
  storeName: 'Tienda',
  status: 'CREATED',
  stockReserved: false,
  paymentMethod: 'wallet',
  deliveryMethod: 'pickup',
  currency: 'COP',
  source: 'web',
  subtotalAmount: 1000,
  discountAmount: 0,
  totalAmount: 1000,
  items: [],
  statusHistory: [createHistoryEntry({ orderId: 'o1', fromStatus: null, toStatus: 'CREATED', actorType: 'system' })],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe('order.models', () => {
  describe('canTransitionOrder', () => {
    it('permite transiciones válidas', () => {
      expect(canTransitionOrder('CREATED', 'PENDING_PAYMENT')).toBe(true);
      expect(canTransitionOrder('PENDING_PAYMENT', 'PAYMENT_APPROVED')).toBe(true);
      expect(canTransitionOrder('READY_FOR_PICKUP', 'DELIVERED')).toBe(true);
    });

    it('rechaza transiciones inválidas', () => {
      expect(canTransitionOrder('DELIVERED', 'CANCELLED')).toBe(false);
      expect(canTransitionOrder('CREATED', 'DELIVERED')).toBe(false);
      expect(canTransitionOrder('CANCELLED', 'CONFIRMED')).toBe(false);
    });
  });

  describe('calculateAmounts', () => {
    it('calcula subtotal y total con descuento', () => {
      const result = calculateAmounts([{ unitPrice: 1000, quantity: 2 }], 500);
      expect(result.subtotalAmount).toBe(2000);
      expect(result.totalAmount).toBe(1500);
    });

    it('nunca produce total negativo', () => {
      const result = calculateAmounts([{ unitPrice: 100, quantity: 1 }], 999);
      expect(result.totalAmount).toBe(0);
    });
  });

  describe('transitionOrder', () => {
    it('actualiza estado y agrega historial', () => {
      const updated = transitionOrder(baseOrder(), { toStatus: 'PENDING_PAYMENT', actorType: 'payment' });
      expect(updated.status).toBe('PENDING_PAYMENT');
      expect(updated.statusHistory).toHaveLength(2);
      expect(updated.statusHistory.at(-1)).toMatchObject({ fromStatus: 'CREATED', toStatus: 'PENDING_PAYMENT' });
    });

    it('marca cancelledAt al cancelar', () => {
      const updated = transitionOrder(baseOrder(), { toStatus: 'CANCELLED', actorType: 'customer' });
      expect(updated.status).toBe('CANCELLED');
      expect(updated.cancelledAt).toBeDefined();
    });

    it('lanza error en transición inválida', () => {
      expect(() => transitionOrder(baseOrder(), { toStatus: 'DELIVERED', actorType: 'system' })).toThrow();
    });
  });

  describe('attachRating', () => {
    it('adjunta la calificación', () => {
      const now = new Date().toISOString();
      const rated = attachRating(baseOrder(), {
        id: 'r1', orderId: 'o1', customerId: 'c1', score: 5, createdAt: now, updatedAt: now,
      });
      expect(rated.rating?.score).toBe(5);
    });
  });
});

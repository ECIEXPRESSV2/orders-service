import { ConflictException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { StoreDirectoryService } from './store-directory.service';
import { RealtimeHubService } from '../../common/realtime-hub.service';
import type { OrderRepository } from './ports/order.repository';
import type { EventPublisher } from './ports/event-publisher';
import type { IdentityPort } from './ports/identity.port';
import type { ProductsPort } from './ports/products.port';
import type { FinancialPort } from './ports/financial.port';
import type { Order, OrderStatus } from '../domain/order.models';
import { CreateOrderDto } from './orders.dto';

class FakeOrderRepository implements OrderRepository {
  store = new Map<string, Order>();
  async save(order: Order) { this.store.set(order.id, JSON.parse(JSON.stringify(order))); return order; }
  async saveTransition(order: Order, expectedFromStatus: OrderStatus) {
    const current = this.store.get(order.id);
    if (!current || current.status !== expectedFromStatus) return null;
    this.store.set(order.id, JSON.parse(JSON.stringify(order)));
    return JSON.parse(JSON.stringify(order));
  }
  async replaceItems(orderId: string, items: Order['items'], amounts: { subtotalAmount: number; discountAmount: number; totalAmount: number }) {
    const o = this.store.get(orderId)!;
    o.items = JSON.parse(JSON.stringify(items));
    o.subtotalAmount = amounts.subtotalAmount;
    o.discountAmount = amounts.discountAmount;
    o.totalAmount = amounts.totalAmount;
    this.store.set(orderId, o);
    return JSON.parse(JSON.stringify(o));
  }
  async markStockReserved(orderId: string) {
    const o = this.store.get(orderId);
    if (!o) return null;
    o.stockReserved = true;
    this.store.set(orderId, o);
    return JSON.parse(JSON.stringify(o));
  }
  async findById(id: string) { const o = this.store.get(id); return o ? JSON.parse(JSON.stringify(o)) : null; }
  async findByIdempotencyKey(key: string) {
    const o = [...this.store.values()].find((order) => order.idempotencyKey === key);
    return o ? JSON.parse(JSON.stringify(o)) : null;
  }
  async findAll() { return [...this.store.values()]; }
  async findByCustomerId(customerId: string) { return [...this.store.values()].filter((o) => o.customerId === customerId); }
  async getFrequentProducts() { return []; }
  async delete(id: string) { this.store.delete(id); }
}

class FakeEventPublisher implements EventPublisher {
  events: Array<{ routingKey: string; payload: Record<string, unknown> }> = [];
  async publish(routingKey: string, payload: Record<string, unknown>) { this.events.push({ routingKey, payload }); }
  keys() { return this.events.map((e) => e.routingKey); }
}

const identity: IdentityPort = {
  getStoreAvailability: async () => ({ available: true }),
  getStoreVendorId: async () => null,
  getStoreStaffIds: async () => [],
  isStoreStaff: async () => true,
  getStoreDisplay: async () => null,
  getUserDisplay: async () => null,
};
const products: ProductsPort = {
  validateItems: async (_s, items) => items.map((i) => ({ ...i })),
  quoteItems: async (_s, items) => items.map((i) => ({
    productId: i.productId,
    name: i.name,
    imageUrl: i.imageUrl,
    listUnitPrice: i.unitPrice,
    unitPrice: i.unitPrice,
    quantity: i.quantity,
    totalAmount: i.unitPrice * i.quantity,
    available: i.quantity,
    hasStock: true,
  })),
};
// Sin recargo de hora pico por defecto: mantiene los totales de los tests (= valor de productos).
const financial: FinancialPort = {
  getCommission: async () => ({ peakFeeAmount: 0, isPeakHour: false, peakFeePercent: 0 }),
};
// Doble mínimo de CommunicationService (solo se usan ensureConversationForOrder / closeConversationForOrder),
// con registro de llamadas para verificar CUÁNDO se abre/cierra el chat del pedido.
class FakeCommunicationService {
  ensuredOrderIds: string[] = [];
  closedOrderIds: string[] = [];
  async ensureConversationForOrder(params: { orderId: string }) {
    this.ensuredOrderIds.push(params.orderId);
    return {};
  }
  async closeConversationForOrder(orderId: string) {
    this.closedOrderIds.push(orderId);
  }
  refundMessages: Array<{ orderId: string; kind: string }> = [];
  async postRefundMessage(orderId: string, payload: { kind: string }) {
    this.refundMessages.push({ orderId, kind: payload.kind });
    return null;
  }
  refundResolutions: Array<{ orderId: string; kind: string }> = [];
  async resolveRefundMessage(orderId: string, patch: { kind: string }) {
    this.refundResolutions.push({ orderId, kind: patch.kind });
    return null;
  }
  reopenedOrderIds: string[] = [];
  async reopenConversationForOrder(orderId: string) {
    this.reopenedOrderIds.push(orderId);
  }
}

const buildDto = (overrides: Partial<CreateOrderDto> = {}): CreateOrderDto => ({
  customerId: 'cust-1',
  storeId: 'store-1',
  storeName: 'Tienda',
  items: [{ productId: 'p1', name: 'Café', unitPrice: 350000, quantity: 2 }],
  paymentMethod: 'wallet',
  deliveryMethod: 'pickup',
  currency: 'COP',
  ...overrides,
});

describe('OrdersService', () => {
  let repo: FakeOrderRepository;
  let events: FakeEventPublisher;
  let communication: FakeCommunicationService;
  let service: OrdersService;

  beforeEach(() => {
    repo = new FakeOrderRepository();
    events = new FakeEventPublisher();
    communication = new FakeCommunicationService();
    service = new OrdersService(
      repo, events, identity, products, financial,
      communication as unknown as import('./communication.service').CommunicationService,
      new RealtimeHubService(), new StoreDirectoryService(),
    );
  });

  it('crea un pedido wallet en PENDING_PAYMENT y emite order.order.created', async () => {
    const order = await service.createOrder(buildDto());
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(order.totalAmount).toBe(700000);
    expect(events.keys()).toContain('order.order.created');
    expect(events.keys()).toContain('order.order.status_changed');
  });

  it('crea un pedido en efectivo en CREATED (espera la reserva de stock), sin confirmar aún', async () => {
    const order = await service.createOrder(buildDto({ paymentMethod: 'cash' }));
    // Option C: el efectivo NO se confirma al crear; espera reservation_confirmed.
    expect(order.status).toBe('CREATED');
    expect(events.keys()).toContain('order.order.created');
    expect(events.keys()).not.toContain('order.order.confirmed');
  });

  it('confirma el pedido en efectivo al recibir reservation_confirmed (Option C)', async () => {
    const created = await service.createOrder(buildDto({ paymentMethod: 'cash' }));
    // El chat (RF-09) no existe todavía en CREATED: se abre recién al confirmarse.
    expect(communication.ensuredOrderIds).not.toContain(created.id);
    events.events = [];
    await service.handleStockReservationConfirmed(created.id);
    const updated = await service.getOrderById(created.id);
    expect(updated.status).toBe('CONFIRMED');
    // pickupExpiresAt ya NO se calcula al confirmar: se calcula al pasar a
    // READY_FOR_PICKUP (cuando la tienda marca el pedido listo para recoger).
    expect(updated.pickupExpiresAt).toBeUndefined();
    expect(events.keys()).toContain('order.order.confirmed');
    expect(communication.ensuredOrderIds).toContain(created.id);
  });

  it('pago digital: reservation_confirmed marca la reserva pero NO confirma sin pago', async () => {
    const created = await service.createOrder(buildDto()); // wallet → PENDING_PAYMENT
    await service.handleStockReservationConfirmed(created.id);
    const updated = await service.getOrderById(created.id);
    // Sigue esperando el pago: la reserva sola no confirma un pedido digital.
    expect(updated.status).toBe('PENDING_PAYMENT');
    expect(events.keys()).not.toContain('order.order.confirmed');
  });

  it('bloquea la creación si la tienda no está disponible', async () => {
    const blocked = new OrdersService(
      repo, events,
      {
        getStoreAvailability: async () => ({ available: false, reason: 'cerrada' }),
        getStoreVendorId: async () => null,
        getStoreStaffIds: async () => [],
        isStoreStaff: async () => false,
        getStoreDisplay: async () => null,
        getUserDisplay: async () => null,
      },
      products,
      financial,
      new FakeCommunicationService() as unknown as import('./communication.service').CommunicationService,
      new RealtimeHubService(), new StoreDirectoryService(),
    );
    await expect(blocked.createOrder(buildDto())).rejects.toBeInstanceOf(ConflictException);
  });

  it('pago digital: applyPaymentApproved retiene en PAYMENT_APPROVED hasta que haya reserva', async () => {
    const created = await service.createOrder(buildDto());
    events.events = [];
    await service.applyPaymentApproved(created.id);
    let updated = await service.getOrderById(created.id);
    // El pago solo NO confirma: espera la reserva de stock (anti-sobreventa).
    expect(updated.status).toBe('PAYMENT_APPROVED');
    expect(events.keys()).not.toContain('order.order.confirmed');
    // Llega la reserva → recién ahí confirma.
    await service.handleStockReservationConfirmed(created.id);
    updated = await service.getOrderById(created.id);
    expect(updated.status).toBe('CONFIRMED');
    expect(events.keys()).toContain('order.order.confirmed');
  });

  it('pago digital: confirma también si la reserva llega ANTES que el pago', async () => {
    const created = await service.createOrder(buildDto());
    await service.handleStockReservationConfirmed(created.id); // reserva primero
    expect((await service.getOrderById(created.id)).status).toBe('PENDING_PAYMENT');
    await service.applyPaymentApproved(created.id); // luego el pago
    expect((await service.getOrderById(created.id)).status).toBe('CONFIRMED');
  });

  it('pago digital: sin reserva, un pago aprobado NO confirma; el rechazo cancela (anti-sobreventa)', async () => {
    const created = await service.createOrder(buildDto());
    await service.applyPaymentApproved(created.id); // pago aprobado, pero stock no reservado
    expect((await service.getOrderById(created.id)).status).toBe('PAYMENT_APPROVED');
    // El perdedor de la última unidad: products publica reservation_rejected.
    await service.handleStockReservationRejected(created.id, 'sin stock');
    const updated = await service.getOrderById(created.id);
    expect(updated.status).toBe('CANCELLED'); // nunca llegó a CONFIRMED
  });

  it('applyPaymentFailed lleva el pedido a FAILED', async () => {
    const created = await service.createOrder(buildDto());
    await service.applyPaymentFailed(created.id, 'fondos insuficientes');
    const updated = await service.getOrderById(created.id);
    expect(updated.status).toBe('FAILED');
  });

  it('cancelOrder emite order.order.cancelled con refundPolicy HALF_PRODUCTS_ONLY', async () => {
    const created = await service.createOrder(buildDto());
    events.events = [];
    await service.cancelOrder(created.id, {});
    const updated = await service.getOrderById(created.id);
    expect(updated.status).toBe('CANCELLED');
    const cancelled = events.events.find((e) => e.routingKey === 'order.order.cancelled');
    expect(cancelled?.payload.refundPolicy).toBe('HALF_PRODUCTS_ONLY');
  });

  it('cancelOrder rechaza con 409 si el pedido ya está listo para retirar', async () => {
    const created = await service.createOrder(buildDto({ paymentMethod: 'cash' })); // CREATED
    await service.handleStockReservationConfirmed(created.id); // → CONFIRMED
    await service.updateOrderStatus(created.id, { status: 'IN_PREPARATION', actorType: 'vendor' });
    await service.updateOrderStatus(created.id, { status: 'READY_FOR_PICKUP', actorType: 'vendor' });
    await expect(service.cancelOrder(created.id, {})).rejects.toBeInstanceOf(ConflictException);
    const unchanged = await service.getOrderById(created.id);
    expect(unchanged.status).toBe('READY_FOR_PICKUP');
  });

  it('handleQrExpired cancela desde READY_FOR_PICKUP con refundPolicy NO_REFUND', async () => {
    const created = await service.createOrder(buildDto({ paymentMethod: 'cash' })); // CREATED
    await service.handleStockReservationConfirmed(created.id); // → CONFIRMED
    await service.updateOrderStatus(created.id, { status: 'IN_PREPARATION', actorType: 'vendor' });
    await service.updateOrderStatus(created.id, { status: 'READY_FOR_PICKUP', actorType: 'vendor' });
    events.events = [];
    await service.handleQrExpired(created.id);
    const updated = await service.getOrderById(created.id);
    expect(updated.status).toBe('CANCELLED');
    const cancelled = events.events.find((e) => e.routingKey === 'order.order.cancelled');
    expect(cancelled?.payload.refundPolicy).toBe('NO_REFUND');
  });

  it('markDelivered transiciona a DELIVERED desde READY_FOR_PICKUP y cierra el chat', async () => {
    const created = await service.createOrder(buildDto({ paymentMethod: 'cash' })); // CREATED
    await service.handleStockReservationConfirmed(created.id); // → CONFIRMED (abre el chat)
    expect(communication.closedOrderIds).not.toContain(created.id);
    await service.updateOrderStatus(created.id, { status: 'IN_PREPARATION', actorType: 'vendor' });
    await service.updateOrderStatus(created.id, { status: 'READY_FOR_PICKUP', actorType: 'vendor' });
    await service.markDelivered(created.id);
    const updated = await service.getOrderById(created.id);
    expect(updated.status).toBe('DELIVERED');
    // Al entregarse, el chat se cierra para siempre (ninguno de los 2 lados vuelve a verlo).
    expect(communication.closedOrderIds).toContain(created.id);
  });

  it('cancelOrder cierra el chat si el pedido ya había sido confirmado', async () => {
    const created = await service.createOrder(buildDto({ paymentMethod: 'cash' })); // CREATED
    await service.handleStockReservationConfirmed(created.id); // → CONFIRMED (abre el chat)
    await service.cancelOrder(created.id, {});
    const updated = await service.getOrderById(created.id);
    expect(updated.status).toBe('CANCELLED');
    expect(communication.closedOrderIds).toContain(created.id);
  });

  it('cancelOrder antes de CONFIRMED nunca llegó a abrir el chat (no hubo ensureConversationForOrder)', async () => {
    const created = await service.createOrder(buildDto()); // wallet → PENDING_PAYMENT, sin chat
    await service.cancelOrder(created.id, {});
    expect(communication.ensuredOrderIds).not.toContain(created.id);
    // orders.service SÍ llama a closeConversationForOrder (no-op si no hay conversación:
    // esa idempotencia la garantiza CommunicationService, cubierto en su propio spec).
  });

  it('no permite calificar un pedido que no fue entregado', async () => {
    const created = await service.createOrder(buildDto()); // PENDING_PAYMENT
    await expect(service.rateOrder(created.id, { score: 5 })).rejects.toBeInstanceOf(ConflictException);
  });

  it('createOrder es idempotente: la misma idempotencyKey no duplica el pedido', async () => {
    const dto = buildDto({ idempotencyKey: 'idem-1' });
    const first = await service.createOrder(dto);
    const second = await service.createOrder(dto);
    expect(second.id).toBe(first.id);
    expect(repo.store.size).toBe(1);
  });

  it('conserva la observación por ítem (notes)', async () => {
    const order = await service.createOrder(
      buildDto({ items: [{ productId: 'p1', name: 'Café', unitPrice: 350000, quantity: 1, notes: 'sin azúcar' }] }),
    );
    expect(order.items[0].notes).toBe('sin azúcar');
  });

  it('expone estimatedReadyAt y usa la hora programada cuando se indica', async () => {
    const when = '2026-06-21T15:30:00.000Z';
    const order = await service.createOrder(buildDto({ scheduledPickupAt: when }));
    expect(order.scheduledPickupAt).toBe(when);
    expect(order.estimatedReadyAt).toBe(when);
  });

  it('UC-015: rechaza una transición inválida con 409 (no 500)', async () => {
    const created = await service.createOrder(buildDto()); // PENDING_PAYMENT
    await expect(
      service.updateOrderStatus(created.id, { status: 'DELIVERED', actorType: 'vendor' }),
    ).rejects.toBeInstanceOf(ConflictException);
    const unchanged = await service.getOrderById(created.id);
    expect(unchanged.status).toBe('PENDING_PAYMENT');
  });

  describe('devoluciones post-recogida (aprobación del vendedor)', () => {
    const toDelivered = async (): Promise<string> => {
      const created = await service.createOrder(buildDto({ paymentMethod: 'cash' })); // CREATED
      await service.handleStockReservationConfirmed(created.id); // → CONFIRMED
      await service.updateOrderStatus(created.id, { status: 'IN_PREPARATION', actorType: 'vendor' });
      await service.updateOrderStatus(created.id, { status: 'READY_FOR_PICKUP', actorType: 'vendor' });
      await service.markDelivered(created.id);
      return created.id;
    };

    it('requestReturn sobre un pedido DELIVERED reabre el chat de inmediato (no espera a que se cotice)', async () => {
      const orderId = await toDelivered();
      expect(communication.closedOrderIds).toContain(orderId); // se cerró al entregar
      communication.reopenedOrderIds = [];
      await service.requestReturn(orderId, { full: true, reason: 'Llegó dañado' });
      expect(communication.reopenedOrderIds).toContain(orderId);
    });

    it('requestReturn sobre un pedido CONFIRMED (pre-recogida) NO reabre el chat', async () => {
      const created = await service.createOrder(buildDto({ paymentMethod: 'cash' }));
      await service.handleStockReservationConfirmed(created.id); // → CONFIRMED
      await service.requestReturn(created.id, { full: true });
      expect(communication.reopenedOrderIds).not.toContain(created.id);
    });

    it('applyReturnPriced NO auto-aplica desde DELIVERED: pasa a RETURN_PENDING_APPROVAL', async () => {
      const orderId = await toDelivered();
      events.events = [];
      await service.applyReturnPriced({
        orderId, storeId: 'store-1', full: true, refundAmount: 700000, lines: [],
      });
      const updated = await service.getOrderById(orderId);
      expect(updated.status).toBe('RETURN_PENDING_APPROVAL');
      expect(updated.pendingReturnAmount).toBe(700000);
      expect(updated.pendingReturnFull).toBe(true);
      expect(events.keys()).not.toContain('order.return.confirmed');
    });

    it('applyReturnPriced auto-aplica desde CONFIRMED (antes de recoger), sin cambios de comportamiento', async () => {
      const created = await service.createOrder(buildDto({ paymentMethod: 'cash' })); // CREATED
      await service.handleStockReservationConfirmed(created.id); // → CONFIRMED
      events.events = [];
      await service.applyReturnPriced({
        orderId: created.id, storeId: 'store-1', full: true, refundAmount: 700000, lines: [],
      });
      const updated = await service.getOrderById(created.id);
      expect(updated.status).toBe('RETURNED');
      expect(events.keys()).toContain('order.return.confirmed');
    });

    it('approveReturn transiciona a RETURNED y publica order.return.confirmed', async () => {
      const orderId = await toDelivered();
      await service.applyReturnPriced({
        orderId, storeId: 'store-1', full: true, refundAmount: 700000, lines: [],
      });
      events.events = [];
      const approved = await service.approveReturn(orderId, 'vendor-1');
      expect(approved.status).toBe('RETURNED');
      expect(approved.pendingReturnAmount).toBeUndefined();
      const confirmed = events.events.find((e) => e.routingKey === 'order.return.confirmed');
      expect(confirmed?.payload).toMatchObject({ full: true, refundAmount: 700000 });
      expect(communication.refundMessages).toContainEqual({ orderId, kind: 'requested' });
      expect(communication.refundResolutions).toContainEqual({ orderId, kind: 'approved' });
    });

    it('rejectReturn restaura DELIVERED y no reembolsa', async () => {
      const orderId = await toDelivered();
      await service.applyReturnPriced({
        orderId, storeId: 'store-1', full: false, refundAmount: 100000, lines: [],
      });
      events.events = [];
      const rejected = await service.rejectReturn(orderId, 'vendor-1', 'Fotos no coinciden');
      expect(rejected.status).toBe('DELIVERED');
      expect(rejected.pendingReturnAmount).toBeUndefined();
      expect(events.keys()).not.toContain('order.return.confirmed');
      expect(communication.refundResolutions).toContainEqual({ orderId, kind: 'rejected' });
    });

    it('approveReturn rechaza con 409 si no hay devolución pendiente', async () => {
      const orderId = await toDelivered();
      await expect(service.approveReturn(orderId, 'vendor-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('approveReturn rechaza con 403 si el actor no es staff de la tienda', async () => {
      const outsider = new OrdersService(
        repo, events,
        { ...identity, isStoreStaff: async () => false },
        products, financial, communication as unknown as import('./communication.service').CommunicationService,
        new RealtimeHubService(), new StoreDirectoryService(),
      );
      const orderId = await toDelivered();
      await outsider.applyReturnPriced({
        orderId, storeId: 'store-1', full: true, refundAmount: 700000, lines: [],
      });
      await expect(outsider.approveReturn(orderId, 'random-user')).rejects.toThrow('No eres staff de la tienda de este pedido');
    });

    it('una segunda devolución parcial sobre PARTIALLY_RETURNED tampoco se auto-aplica', async () => {
      const orderId = await toDelivered();
      await service.applyReturnPriced({
        orderId, storeId: 'store-1', full: false, refundAmount: 100000, lines: [],
      });
      await service.approveReturn(orderId, 'vendor-1'); // → PARTIALLY_RETURNED
      expect((await service.getOrderById(orderId)).status).toBe('PARTIALLY_RETURNED');

      events.events = [];
      await service.applyReturnPriced({
        orderId, storeId: 'store-1', full: false, refundAmount: 50000, lines: [],
      });
      const updated = await service.getOrderById(orderId);
      expect(updated.status).toBe('RETURN_PENDING_APPROVAL');
      expect(events.keys()).not.toContain('order.return.confirmed');

      await service.rejectReturn(orderId, 'vendor-1');
      expect((await service.getOrderById(orderId)).status).toBe('PARTIALLY_RETURNED');
    });
  });

  it('UC-018: lanza conflicto si la transición fue pisada concurrentemente', async () => {
    const created = await service.createOrder(buildDto({ paymentMethod: 'cash' })); // CREATED
    await service.handleStockReservationConfirmed(created.id); // → CONFIRMED
    // Simula que otro proceso cambió el estado entre la lectura y el guardado.
    jest.spyOn(repo, 'saveTransition').mockResolvedValueOnce(null);
    await expect(
      service.updateOrderStatus(created.id, { status: 'IN_PREPARATION', actorType: 'vendor' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

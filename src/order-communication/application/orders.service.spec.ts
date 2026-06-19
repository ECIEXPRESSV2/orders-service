import { ConflictException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { RealtimeHubService } from '../../common/realtime-hub.service';
import type { OrderRepository } from './ports/order.repository';
import type { EventPublisher } from './ports/event-publisher';
import type { IdentityPort } from './ports/identity.port';
import type { ProductsPort } from './ports/products.port';
import type { Order } from '../domain/order.models';
import { CreateOrderDto } from './orders.dto';

class FakeOrderRepository implements OrderRepository {
  store = new Map<string, Order>();
  async save(order: Order) { this.store.set(order.id, JSON.parse(JSON.stringify(order))); return order; }
  async findById(id: string) { const o = this.store.get(id); return o ? JSON.parse(JSON.stringify(o)) : null; }
  async findAll() { return [...this.store.values()]; }
  async findByCustomerId(customerId: string) { return [...this.store.values()].filter((o) => o.customerId === customerId); }
  async getFrequentProducts() { return []; }
}

class FakeEventPublisher implements EventPublisher {
  events: Array<{ routingKey: string; payload: Record<string, unknown> }> = [];
  async publish(routingKey: string, payload: Record<string, unknown>) { this.events.push({ routingKey, payload }); }
  keys() { return this.events.map((e) => e.routingKey); }
}

const identity: IdentityPort = { getStoreAvailability: async () => ({ available: true }) };
const products: ProductsPort = { validateItems: async (_s, items) => items.map((i) => ({ ...i })) };
// Doble mínimo de CommunicationService (solo se usa ensureConversationForOrder).
const communication = { ensureConversationForOrder: async () => ({}) } as unknown as import('./communication.service').CommunicationService;

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
  let service: OrdersService;

  beforeEach(() => {
    repo = new FakeOrderRepository();
    events = new FakeEventPublisher();
    service = new OrdersService(repo, events, identity, products, communication, new RealtimeHubService());
  });

  it('crea un pedido wallet en PENDING_PAYMENT y emite order.order.created', async () => {
    const order = await service.createOrder(buildDto());
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(order.totalAmount).toBe(700000);
    expect(events.keys()).toContain('order.order.created');
    expect(events.keys()).toContain('order.order.status_changed');
  });

  it('crea un pedido en efectivo directamente en CONFIRMED con pickupExpiresAt y emite confirmed', async () => {
    const order = await service.createOrder(buildDto({ paymentMethod: 'cash' }));
    expect(order.status).toBe('CONFIRMED');
    expect(order.pickupExpiresAt).toBeDefined();
    expect(events.keys()).toContain('order.order.confirmed');
  });

  it('bloquea la creación si la tienda no está disponible', async () => {
    const blocked = new OrdersService(
      repo, events,
      { getStoreAvailability: async () => ({ available: false, reason: 'cerrada' }) },
      products, communication, new RealtimeHubService(),
    );
    await expect(blocked.createOrder(buildDto())).rejects.toBeInstanceOf(ConflictException);
  });

  it('applyPaymentApproved lleva el pedido a CONFIRMED y emite order.order.confirmed', async () => {
    const created = await service.createOrder(buildDto());
    events.events = [];
    await service.applyPaymentApproved(created.id);
    const updated = await service.getOrderById(created.id);
    expect(updated.status).toBe('CONFIRMED');
    expect(events.keys()).toContain('order.order.confirmed');
  });

  it('applyPaymentFailed lleva el pedido a FAILED', async () => {
    const created = await service.createOrder(buildDto());
    await service.applyPaymentFailed(created.id, 'fondos insuficientes');
    const updated = await service.getOrderById(created.id);
    expect(updated.status).toBe('FAILED');
  });

  it('cancelOrder emite order.order.cancelled', async () => {
    const created = await service.createOrder(buildDto());
    events.events = [];
    await service.cancelOrder(created.id, {});
    const updated = await service.getOrderById(created.id);
    expect(updated.status).toBe('CANCELLED');
    expect(events.keys()).toContain('order.order.cancelled');
  });

  it('markDelivered transiciona a DELIVERED desde READY_FOR_PICKUP', async () => {
    const created = await service.createOrder(buildDto({ paymentMethod: 'cash' })); // CONFIRMED
    await service.updateOrderStatus(created.id, { status: 'IN_PREPARATION', actorType: 'vendor' });
    await service.updateOrderStatus(created.id, { status: 'READY_FOR_PICKUP', actorType: 'vendor' });
    await service.markDelivered(created.id);
    const updated = await service.getOrderById(created.id);
    expect(updated.status).toBe('DELIVERED');
  });

  it('no permite calificar un pedido que no fue entregado', async () => {
    const created = await service.createOrder(buildDto()); // PENDING_PAYMENT
    await expect(service.rateOrder(created.id, { score: 5 })).rejects.toBeInstanceOf(ConflictException);
  });
});

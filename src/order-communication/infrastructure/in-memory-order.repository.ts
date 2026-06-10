import { Injectable } from '@nestjs/common';
import { Order, OrderItem, attachRating, calculateAmounts, createHistoryEntry } from '../domain/order.models';

@Injectable()
export class InMemoryOrderRepository {
  private readonly orders = new Map<string, Order>();

  constructor() {
    this.seed();
  }

  async save(order: Order): Promise<Order> {
    this.orders.set(order.id, structuredClone(order));
    return structuredClone(order);
  }

  async findById(id: string): Promise<Order | null> {
    const order = this.orders.get(id);
    return order ? structuredClone(order) : null;
  }

  async findAll(filters?: { customerId?: string; status?: string }): Promise<Order[]> {
    return [...this.orders.values()]
      .filter((order) => !filters?.customerId || order.customerId === filters.customerId)
      .filter((order) => !filters?.status || order.status === filters.status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((order) => structuredClone(order));
  }

  async findByCustomerId(customerId: string): Promise<Order[]> {
    return [...this.orders.values()]
      .filter((order) => order.customerId === customerId)
      .map((order) => structuredClone(order));
  }

  async getFrequentProducts(customerId?: string): Promise<Array<{ productId: number; name: string; imageUrl?: string; totalOrders: number }>> {
    const accumulator = new Map<number, { productId: number; name: string; imageUrl?: string; totalOrders: number }>();

    for (const order of this.orders.values()) {
      if (customerId && order.customerId !== customerId) {
        continue;
      }

      for (const item of order.items) {
        const current = accumulator.get(item.productId) ?? {
          productId: item.productId,
          name: item.name,
          imageUrl: item.imageUrl,
          totalOrders: 0,
        };

        current.totalOrders += item.quantity;
        accumulator.set(item.productId, current);
      }
    }

    return [...accumulator.values()].sort((left, right) => right.totalOrders - left.totalOrders);
  }

  private seed(): void {
    const item: OrderItem = {
      id: crypto.randomUUID(),
      productId: 1,
      name: 'Combo Hamburguesa',
      description: 'Hamburguesa con papas y gaseosa',
      imageUrl: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=200&auto=format&fit=crop',
      unitPrice: 15000,
      quantity: 1,
      totalAmount: 15000,
    };
    const createdAt = new Date(Date.now() - 1000 * 60 * 30).toISOString();
    const amounts = calculateAmounts([item]);
    const order: Order = {
      id: crypto.randomUUID(),
      orderNumber: 'OC-0001',
      customerId: 'student-001',
      storeId: 1,
      storeName: 'Café Central',
      status: 'READY_FOR_PICKUP',
      paymentMethod: 'wallet',
      deliveryMethod: 'pickup',
      currency: 'COP',
      source: 'web',
      subtotalAmount: amounts.subtotalAmount,
      discountAmount: 0,
      totalAmount: amounts.totalAmount,
      items: [item],
      statusHistory: [
        createHistoryEntry({ orderId: 'seed', fromStatus: null, toStatus: 'CREATED', actorType: 'system' }),
      ],
      createdAt,
      updatedAt: createdAt,
    };

    order.statusHistory = [
      createHistoryEntry({ orderId: order.id, fromStatus: null, toStatus: 'CREATED', actorType: 'system' }),
      createHistoryEntry({ orderId: order.id, fromStatus: 'CREATED', toStatus: 'PENDING_PAYMENT', actorType: 'payment' }),
      createHistoryEntry({ orderId: order.id, fromStatus: 'PENDING_PAYMENT', toStatus: 'PAYMENT_APPROVED', actorType: 'payment' }),
      createHistoryEntry({ orderId: order.id, fromStatus: 'PAYMENT_APPROVED', toStatus: 'CONFIRMED', actorType: 'fulfillment' }),
      createHistoryEntry({ orderId: order.id, fromStatus: 'CONFIRMED', toStatus: 'IN_PREPARATION', actorType: 'vendor' }),
      createHistoryEntry({ orderId: order.id, fromStatus: 'IN_PREPARATION', toStatus: 'READY_FOR_PICKUP', actorType: 'vendor' }),
    ];

    this.orders.set(order.id, order);
  }
}
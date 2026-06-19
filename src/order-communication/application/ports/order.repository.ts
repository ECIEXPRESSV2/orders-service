import type { Order } from '../../domain/order.models';

export interface FrequentProduct {
  productId: string;
  name: string;
  imageUrl?: string;
  totalOrders: number;
}

/**
 * Puerto de persistencia de pedidos. La capa de aplicación depende de esta
 * interfaz, no de una implementación concreta (TypeORM / in-memory).
 */
export interface OrderRepository {
  save(order: Order): Promise<Order>;
  findById(id: string): Promise<Order | null>;
  findAll(filters?: { customerId?: string; status?: string }): Promise<Order[]>;
  findByCustomerId(customerId: string): Promise<Order[]>;
  getFrequentProducts(customerId?: string): Promise<FrequentProduct[]>;
}

export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY');

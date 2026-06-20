import type { Order, OrderItem } from '../../domain/order.models';

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
  /**
   * Reemplaza atómicamente las líneas de un pedido (carrito) y sus montos,
   * eliminando las líneas huérfanas. Devuelve el pedido recargado.
   */
  replaceItems(
    orderId: string,
    items: OrderItem[],
    amounts: { subtotalAmount: number; discountAmount: number; totalAmount: number },
  ): Promise<Order>;
  findById(id: string): Promise<Order | null>;
  findAll(filters?: { customerId?: string; status?: string }): Promise<Order[]>;
  findByCustomerId(customerId: string): Promise<Order[]>;
  getFrequentProducts(customerId?: string): Promise<FrequentProduct[]>;
}

export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY');

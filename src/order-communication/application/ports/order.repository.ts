import type { Order, OrderItem, OrderStatus } from '../../domain/order.models';

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
   * Persiste una transición de estado de forma atómica y segura ante concurrencia:
   * solo la aplica si el pedido sigue en `expectedFromStatus` (compare-and-set).
   * Devuelve el pedido actualizado, o `null` si otro proceso ya cambió el estado.
   */
  saveTransition(order: Order, expectedFromStatus: OrderStatus): Promise<Order | null>;
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
  /** Devuelve el pedido creado con esa clave de idempotencia, si existe. */
  findByIdempotencyKey(idempotencyKey: string): Promise<Order | null>;
  findAll(filters?: { customerId?: string; storeId?: string; status?: string }): Promise<Order[]>;
  findByCustomerId(customerId: string): Promise<Order[]>;
  getFrequentProducts(customerId?: string): Promise<FrequentProduct[]>;
}

export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY');

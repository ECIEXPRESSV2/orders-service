import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Order, OrderItem, OrderStatus } from '../../domain/order.models';
import type { FrequentProduct, OrderRepository } from '../../application/ports/order.repository';
import { OrderEntity } from './order.entity';
import { OrderItemEntity } from './order-item.entity';
import { OrderStatusHistoryEntity } from './order-status-history.entity';
import { OrderRatingEntity } from './order-rating.entity';

const iso = (date?: Date | null): string | undefined => (date ? date.toISOString() : undefined);

@Injectable()
export class TypeOrmOrderRepository implements OrderRepository {
  constructor(
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
  ) {}

  async save(order: Order): Promise<Order> {
    const entity = this.toEntity(order);
    const saved = await this.orders.save(entity);
    // Recargamos para garantizar relaciones eager consistentes.
    const reloaded = await this.orders.findOne({ where: { id: saved.id } });
    return this.toDomain(reloaded ?? saved);
  }

  async replaceItems(
    orderId: string,
    items: OrderItem[],
    amounts: { subtotalAmount: number; discountAmount: number; totalAmount: number },
  ): Promise<Order> {
    await this.orders.manager.transaction(async (manager) => {
      await manager.delete(OrderItemEntity, { orderId });
      if (items.length > 0) {
        await manager.insert(
          OrderItemEntity,
          items.map((item) => ({
            id: item.id,
            orderId,
            productId: item.productId,
            name: item.name,
            description: item.description ?? null,
            notes: item.notes ?? null,
            imageUrl: item.imageUrl ?? null,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            totalAmount: item.totalAmount,
          })),
        );
      }
      await manager.update(
        OrderEntity,
        { id: orderId },
        {
          subtotalAmount: amounts.subtotalAmount,
          discountAmount: amounts.discountAmount,
          totalAmount: amounts.totalAmount,
        },
      );
    });
    const reloaded = await this.orders.findOne({ where: { id: orderId } });
    return this.toDomain(reloaded!);
  }

  async saveTransition(order: Order, expectedFromStatus: OrderStatus): Promise<Order | null> {
    return this.orders.manager.transaction(async (manager) => {
      // Compare-and-set: solo cambia el estado si sigue siendo el esperado. Si otro
      // proceso ya transicionó el pedido, affected = 0 y devolvemos null (conflicto).
      const result = await manager.update(
        OrderEntity,
        { id: order.id, status: expectedFromStatus },
        {
          status: order.status,
          pickupExpiresAt: order.pickupExpiresAt ? new Date(order.pickupExpiresAt) : null,
          cancelledAt: order.cancelledAt ? new Date(order.cancelledAt) : null,
        },
      );
      if (!result.affected) return null;

      // Inserta solo la última entrada del historial (la generada por esta transición).
      const last = order.statusHistory[order.statusHistory.length - 1];
      if (last) {
        await manager.insert(OrderStatusHistoryEntity, {
          id: last.id,
          orderId: order.id,
          fromStatus: last.fromStatus,
          toStatus: last.toStatus,
          actorType: last.actorType,
          actorId: last.actorId ?? null,
          reason: last.reason ?? null,
          occurredAt: new Date(last.occurredAt),
        });
      }

      const reloaded = await manager.findOne(OrderEntity, { where: { id: order.id } });
      return reloaded ? this.toDomain(reloaded) : null;
    });
  }

  async findById(id: string): Promise<Order | null> {
    const entity = await this.orders.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<Order | null> {
    const entity = await this.orders.findOne({ where: { idempotencyKey } });
    return entity ? this.toDomain(entity) : null;
  }

  async findAll(filters?: { customerId?: string; storeId?: string; status?: string }): Promise<Order[]> {
    const where: Record<string, unknown> = {};
    if (filters?.customerId) where.customerId = filters.customerId;
    if (filters?.storeId) where.storeId = filters.storeId;
    if (filters?.status) where.status = filters.status;
    const entities = await this.orders.find({ where, order: { createdAt: 'DESC' } });
    return entities.map((entity) => this.toDomain(entity));
  }

  async findByCustomerId(customerId: string): Promise<Order[]> {
    const entities = await this.orders.find({ where: { customerId }, order: { createdAt: 'DESC' } });
    return entities.map((entity) => this.toDomain(entity));
  }

  async getFrequentProducts(customerId?: string): Promise<FrequentProduct[]> {
    const entities = await this.orders.find({ where: customerId ? { customerId } : {} });
    const accumulator = new Map<string, FrequentProduct>();
    for (const order of entities) {
      for (const item of order.items ?? []) {
        const current = accumulator.get(item.productId) ?? {
          productId: item.productId,
          name: item.name,
          imageUrl: item.imageUrl ?? undefined,
          totalOrders: 0,
        };
        current.totalOrders += item.quantity;
        accumulator.set(item.productId, current);
      }
    }
    return [...accumulator.values()].sort((a, b) => b.totalOrders - a.totalOrders);
  }

  // ─── mappers ────────────────────────────────────────────────
  private toEntity(order: Order): OrderEntity {
    const entity = new OrderEntity();
    entity.id = order.id;
    entity.orderNumber = order.orderNumber;
    entity.customerId = order.customerId;
    entity.storeId = order.storeId;
    entity.storeName = order.storeName;
    entity.status = order.status;
    entity.paymentMethod = order.paymentMethod;
    entity.deliveryMethod = order.deliveryMethod;
    entity.currency = order.currency;
    entity.source = order.source;
    entity.notes = order.notes ?? null;
    entity.idempotencyKey = order.idempotencyKey ?? null;
    entity.scheduledPickupAt = order.scheduledPickupAt ? new Date(order.scheduledPickupAt) : null;
    entity.subtotalAmount = order.subtotalAmount;
    entity.discountAmount = order.discountAmount;
    entity.totalAmount = order.totalAmount;
    entity.pickupExpiresAt = order.pickupExpiresAt ? new Date(order.pickupExpiresAt) : null;
    entity.cancelledAt = order.cancelledAt ? new Date(order.cancelledAt) : null;
    entity.deletedAt = order.deletedAt ? new Date(order.deletedAt) : null;

    entity.items = order.items.map((item) => {
      const itemEntity = new OrderItemEntity();
      itemEntity.id = item.id;
      itemEntity.orderId = order.id;
      itemEntity.productId = item.productId;
      itemEntity.name = item.name;
      itemEntity.description = item.description ?? null;
      itemEntity.notes = item.notes ?? null;
      itemEntity.imageUrl = item.imageUrl ?? null;
      itemEntity.unitPrice = item.unitPrice;
      itemEntity.quantity = item.quantity;
      itemEntity.totalAmount = item.totalAmount;
      return itemEntity;
    });

    entity.statusHistory = order.statusHistory.map((history) => {
      const historyEntity = new OrderStatusHistoryEntity();
      historyEntity.id = history.id;
      historyEntity.orderId = order.id;
      historyEntity.fromStatus = history.fromStatus;
      historyEntity.toStatus = history.toStatus;
      historyEntity.actorType = history.actorType;
      historyEntity.actorId = history.actorId ?? null;
      historyEntity.reason = history.reason ?? null;
      historyEntity.occurredAt = new Date(history.occurredAt);
      return historyEntity;
    });

    if (order.rating) {
      const ratingEntity = new OrderRatingEntity();
      ratingEntity.id = order.rating.id;
      ratingEntity.orderId = order.id;
      ratingEntity.customerId = order.rating.customerId;
      ratingEntity.score = order.rating.score;
      ratingEntity.comment = order.rating.comment ?? null;
      ratingEntity.createdAt = new Date(order.rating.createdAt);
      ratingEntity.updatedAt = new Date(order.rating.updatedAt);
      entity.rating = ratingEntity;
    } else {
      entity.rating = null;
    }

    return entity;
  }

  private toDomain(entity: OrderEntity): Order {
    const items = (entity.items ?? [])
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.name,
        description: item.description ?? undefined,
        notes: item.notes ?? undefined,
        imageUrl: item.imageUrl ?? undefined,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        totalAmount: item.totalAmount,
      }));

    const statusHistory = (entity.statusHistory ?? [])
      .slice()
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
      .map((history) => ({
        id: history.id,
        orderId: entity.id,
        fromStatus: history.fromStatus,
        toStatus: history.toStatus,
        actorType: history.actorType,
        actorId: history.actorId ?? undefined,
        reason: history.reason ?? undefined,
        occurredAt: history.occurredAt.toISOString(),
      }));

    return {
      id: entity.id,
      orderNumber: entity.orderNumber,
      customerId: entity.customerId,
      storeId: entity.storeId,
      storeName: entity.storeName,
      status: entity.status,
      paymentMethod: entity.paymentMethod,
      deliveryMethod: entity.deliveryMethod,
      currency: entity.currency,
      source: entity.source,
      notes: entity.notes ?? undefined,
      idempotencyKey: entity.idempotencyKey ?? undefined,
      scheduledPickupAt: iso(entity.scheduledPickupAt),
      subtotalAmount: entity.subtotalAmount,
      discountAmount: entity.discountAmount,
      totalAmount: entity.totalAmount,
      items,
      statusHistory,
      rating: entity.rating
        ? {
            id: entity.rating.id,
            orderId: entity.id,
            customerId: entity.rating.customerId,
            score: entity.rating.score,
            comment: entity.rating.comment ?? undefined,
            createdAt: entity.rating.createdAt.toISOString(),
            updatedAt: entity.rating.updatedAt.toISOString(),
          }
        : undefined,
      pickupExpiresAt: iso(entity.pickupExpiresAt),
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
      cancelledAt: iso(entity.cancelledAt),
      deletedAt: iso(entity.deletedAt),
    };
  }
}

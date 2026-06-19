import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { RealtimeHubService } from '../../common/realtime-hub.service';
import { ORDER_REPOSITORY } from './ports/order.repository';
import type { OrderRepository } from './ports/order.repository';
import { EVENT_PUBLISHER } from './ports/event-publisher';
import type { EventPublisher } from './ports/event-publisher';
import { ORDER_EVENTS } from '../infrastructure/messaging/event-contracts';
import { CreateOrderDto, CancelOrderDto, FrequentProductDto, OrderResponseDto, RateOrderDto, UpdateOrderStatusDto } from './orders.dto';
import {
  attachRating,
  calculateAmounts,
  canTransitionOrder,
  createHistoryEntry,
  Order,
  OrderActorType,
  OrderStatus,
  transitionOrder,
} from '../domain/order.models';

const PICKUP_WINDOW_MS = Number(process.env.PICKUP_WINDOW_HOURS ?? 2) * 3_600_000;

@Injectable()
export class OrdersService {
  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    private readonly realtimeHub: RealtimeHubService,
  ) {}

  async createOrder(dto: CreateOrderDto): Promise<OrderResponseDto> {
    if (!dto.items.length) {
      throw new BadRequestException('At least one item is required');
    }
    if (!dto.customerId) {
      throw new BadRequestException('customerId is required');
    }
    const customerId = dto.customerId;

    const orderId = crypto.randomUUID();
    const resolvedItems = dto.items.map((item) => ({
      id: crypto.randomUUID(),
      productId: item.productId,
      name: item.name,
      description: item.description,
      imageUrl: item.imageUrl,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      totalAmount: item.unitPrice * item.quantity,
    }));
    const discountAmount = dto.discountAmount ?? 0;
    const amounts = calculateAmounts(resolvedItems, discountAmount);
    const createdAt = new Date().toISOString();

    let order: Order = {
      id: orderId,
      orderNumber: `OC-${createdAt.slice(0, 10).replaceAll('-', '')}-${Math.floor(Math.random() * 9000 + 1000)}`,
      customerId,
      storeId: dto.storeId,
      storeName: dto.storeName,
      status: 'CREATED',
      paymentMethod: dto.paymentMethod,
      deliveryMethod: dto.deliveryMethod,
      currency: dto.currency,
      source: dto.source ?? 'web',
      notes: dto.notes,
      subtotalAmount: amounts.subtotalAmount,
      discountAmount,
      totalAmount: amounts.totalAmount,
      items: resolvedItems,
      statusHistory: [createHistoryEntry({ orderId, fromStatus: null, toStatus: 'CREATED', actorType: 'system' })],
      createdAt,
      updatedAt: createdAt,
    };

    await this.orderRepository.save(order);
    // Evento de creación: financial retiene el pago, notifications avisa al comprador.
    await this.events.publish(ORDER_EVENTS.CREATED, {
      orderId: order.id,
      buyerId: order.customerId,
      storeId: order.storeId,
      totalAmount: order.totalAmount,
      paymentMethod: order.paymentMethod,
    });
    this.broadcast(order);

    const previous = order.status;
    if (dto.paymentMethod === 'cash') {
      // Efectivo: la tienda confirma; no hay retención de billetera.
      order = this.transitionTo(order, 'CONFIRMED', 'fulfillment', 'Cash order confirmed by store');
    } else {
      // Pago digital: queda a la espera del resultado de financial-service.
      order = this.transitionTo(order, 'PENDING_PAYMENT', 'payment', 'Awaiting payment approval');
    }
    await this.finalize(previous, order);

    return this.toResponse(order);
  }

  async getOrders(query?: { customerId?: string; status?: string }): Promise<OrderResponseDto[]> {
    const orders = await this.orderRepository.findAll(query);
    return orders.map((order) => this.toResponse(order));
  }

  async getOrderById(id: string): Promise<OrderResponseDto> {
    const order = await this.orderRepository.findById(id);
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return this.toResponse(order);
  }

  async updateOrderStatus(id: string, dto: UpdateOrderStatusDto): Promise<OrderResponseDto> {
    const order = await this.requireOrder(id);
    const previous = order.status;
    const updated = this.transitionTo(order, dto.status, dto.actorType as OrderActorType, dto.reason, dto.actorId);
    await this.finalize(previous, updated);
    return this.toResponse(updated);
  }

  async cancelOrder(id: string, dto: CancelOrderDto): Promise<OrderResponseDto> {
    const order = await this.requireOrder(id);
    if (order.status === 'DELIVERED' || order.status === 'CANCELLED') {
      throw new ConflictException('Delivered or cancelled orders cannot be cancelled again');
    }
    const previous = order.status;
    const updated = this.transitionTo(
      order,
      'CANCELLED',
      (dto.actorType as OrderActorType) ?? 'customer',
      dto.reason ?? 'Cancelled by user',
      dto.actorId,
    );
    await this.finalize(previous, updated);
    return this.toResponse(updated);
  }

  async rateOrder(id: string, dto: RateOrderDto): Promise<OrderResponseDto> {
    const order = await this.requireOrder(id);
    if (order.status !== 'DELIVERED' && order.status !== 'READY_FOR_PICKUP') {
      throw new ConflictException('Orders can only be rated after fulfillment');
    }
    if (order.rating) {
      throw new ConflictException('Order already rated');
    }

    const now = new Date().toISOString();
    const ratedOrder = attachRating(order, {
      id: crypto.randomUUID(),
      orderId: order.id,
      customerId: dto.customerId ?? order.customerId,
      score: dto.score,
      comment: dto.comment,
      createdAt: now,
      updatedAt: now,
    });

    await this.orderRepository.save(ratedOrder);
    return this.toResponse(ratedOrder);
  }

  async getHistory(customerId?: string): Promise<OrderResponseDto[]> {
    if (!customerId) return [];
    return (await this.orderRepository.findByCustomerId(customerId)).map((order) => this.toResponse(order));
  }

  async getFrequent(customerId?: string): Promise<FrequentProductDto[]> {
    const products = await this.orderRepository.getFrequentProducts(customerId);
    return products.map((product) => ({
      productId: product.productId,
      name: product.name,
      imageUrl: product.imageUrl,
      totalOrders: product.totalOrders,
    }));
  }

  // ─── Acciones disparadas por eventos entrantes (RabbitMQ) ────────
  // Order es el único dueño del estado: financial/fulfillment solo publican
  // eventos; aquí se deciden las transiciones.

  /** financial.payment.processed -> PAYMENT_APPROVED -> CONFIRMED */
  async applyPaymentApproved(orderId: string): Promise<void> {
    const order = await this.orderRepository.findById(orderId);
    if (!order || order.status !== 'PENDING_PAYMENT') return;
    const approved = this.transitionTo(order, 'PAYMENT_APPROVED', 'payment', 'Payment held by financial-service');
    await this.finalize(order.status, approved);
    const confirmed = this.transitionTo(approved, 'CONFIRMED', 'payment', 'Payment captured');
    await this.finalize(approved.status, confirmed);
  }

  /** financial.payment.failed -> FAILED */
  async applyPaymentFailed(orderId: string, reason?: string): Promise<void> {
    const order = await this.orderRepository.findById(orderId);
    if (!order || !canTransitionOrder(order.status, 'FAILED')) return;
    const failed = this.transitionTo(order, 'FAILED', 'payment', reason ?? 'Payment failed');
    await this.finalize(order.status, failed);
  }

  /** fulfillment.delivery.confirmed -> DELIVERED */
  async markDelivered(orderId: string): Promise<void> {
    const order = await this.orderRepository.findById(orderId);
    if (!order || !canTransitionOrder(order.status, 'DELIVERED')) return;
    const delivered = this.transitionTo(order, 'DELIVERED', 'fulfillment', 'Delivery confirmed');
    await this.finalize(order.status, delivered);
  }

  /** fulfillment.delivery.failed -> FAILED */
  async markFailed(orderId: string, reason?: string): Promise<void> {
    const order = await this.orderRepository.findById(orderId);
    if (!order || !canTransitionOrder(order.status, 'FAILED')) return;
    const failed = this.transitionTo(order, 'FAILED', 'fulfillment', reason ?? 'Delivery failed');
    await this.finalize(order.status, failed);
  }

  /** fulfillment.qr.expired -> CANCELLED (dispara reembolso en financial) */
  async handleQrExpired(orderId: string): Promise<void> {
    const order = await this.orderRepository.findById(orderId);
    if (!order || !canTransitionOrder(order.status, 'CANCELLED')) return;
    const cancelled = this.transitionTo(order, 'CANCELLED', 'fulfillment', 'Pickup QR expired');
    await this.finalize(order.status, cancelled);
  }

  // ─── helpers ────────────────────────────────────────────────
  private transitionTo(
    order: Order,
    toStatus: OrderStatus,
    actorType: OrderActorType,
    reason?: string,
    actorId?: string,
  ): Order {
    let updated = transitionOrder(order, { toStatus, actorType, actorId, reason });
    if (toStatus === 'CONFIRMED' && !updated.pickupExpiresAt) {
      updated = { ...updated, pickupExpiresAt: new Date(Date.now() + PICKUP_WINDOW_MS).toISOString() };
    }
    return updated;
  }

  /** Persiste, emite eventos de dominio y notifica por WebSocket. */
  private async finalize(previousStatus: OrderStatus, order: Order): Promise<void> {
    await this.orderRepository.save(order);
    await this.events.publish(ORDER_EVENTS.STATUS_CHANGED, {
      orderId: order.id,
      buyerId: order.customerId,
      status: order.status,
    });
    if (order.status === 'CONFIRMED' && previousStatus !== 'CONFIRMED') {
      await this.events.publish(ORDER_EVENTS.CONFIRMED, {
        orderId: order.id,
        buyerId: order.customerId,
        storeId: order.storeId,
        pickupExpiresAt: order.pickupExpiresAt,
      });
    }
    if (order.status === 'CANCELLED' && previousStatus !== 'CANCELLED') {
      await this.events.publish(ORDER_EVENTS.CANCELLED, {
        orderId: order.id,
        buyerId: order.customerId,
      });
    }
    this.broadcast(order);
  }

  private broadcast(order: Order): void {
    this.realtimeHub.publish({
      type: 'order:status-updated',
      room: `order:${order.id}`,
      payload: this.toResponse(order),
      occurredAt: new Date().toISOString(),
    });
  }

  private async requireOrder(id: string): Promise<Order> {
    const order = await this.orderRepository.findById(id);
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return order;
  }

  private toResponse(order: Order): OrderResponseDto {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customerId,
      storeId: order.storeId,
      storeName: order.storeName,
      status: order.status,
      paymentMethod: order.paymentMethod,
      deliveryMethod: order.deliveryMethod,
      currency: order.currency,
      source: order.source,
      notes: order.notes,
      subtotalAmount: order.subtotalAmount,
      discountAmount: order.discountAmount,
      totalAmount: order.totalAmount,
      items: order.items,
      statusHistory: order.statusHistory,
      rating: order.rating,
      pickupExpiresAt: order.pickupExpiresAt,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      cancelledAt: order.cancelledAt,
    };
  }
}

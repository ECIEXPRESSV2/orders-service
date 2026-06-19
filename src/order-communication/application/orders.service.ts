import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { RealtimeHubService } from '../../common/realtime-hub.service';
import { ORDER_REPOSITORY } from './ports/order.repository';
import type { OrderRepository } from './ports/order.repository';
import { CreateOrderDto, CancelOrderDto, FrequentProductDto, OrderResponseDto, RateOrderDto, UpdateOrderStatusDto } from './orders.dto';
import { attachRating, calculateAmounts, createHistoryEntry, Order, transitionOrder } from '../domain/order.models';

@Injectable()
export class OrdersService {
  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository,
    private readonly realtimeHub: RealtimeHubService,
  ) {}

  async createOrder(dto: CreateOrderDto): Promise<OrderResponseDto> {
    if (!dto.items.length) {
      throw new BadRequestException('At least one item is required');
    }

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
      customerId: dto.customerId,
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

    if (dto.paymentMethod === 'cash') {
      order = transitionOrder(order, { toStatus: 'CONFIRMED', actorType: 'fulfillment', reason: 'Cash order confirmed by store' });
    } else {
      order = transitionOrder(order, { toStatus: 'PENDING_PAYMENT', actorType: 'payment', reason: 'Awaiting payment approval' });
      order = transitionOrder(order, { toStatus: 'PAYMENT_APPROVED', actorType: 'payment', reason: 'Fake payment approved' });
      order = transitionOrder(order, { toStatus: 'CONFIRMED', actorType: 'fulfillment', reason: 'Fake fulfillment confirmed' });
    }

    await this.orderRepository.save(order);
    this.realtimeHub.publish({
      type: 'order:status-updated',
      room: `order:${order.id}`,
      payload: this.toResponse(order),
      occurredAt: new Date().toISOString(),
    });
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
    const updatedOrder = transitionOrder(order, {
      toStatus: dto.status,
      actorType: dto.actorType as any,
      actorId: dto.actorId,
      reason: dto.reason,
    });

    await this.orderRepository.save(updatedOrder);
    this.realtimeHub.publish({
      type: 'order:status-updated',
      room: `order:${updatedOrder.id}`,
      payload: this.toResponse(updatedOrder),
      occurredAt: new Date().toISOString(),
    });
    return this.toResponse(updatedOrder);
  }

  async cancelOrder(id: string, dto: CancelOrderDto): Promise<OrderResponseDto> {
    const order = await this.requireOrder(id);
    if (order.status === 'DELIVERED' || order.status === 'CANCELLED') {
      throw new ConflictException('Delivered or cancelled orders cannot be cancelled again');
    }

    const updatedOrder = transitionOrder(order, {
      toStatus: 'CANCELLED',
      actorType: dto.actorType as any,
      actorId: dto.actorId,
      reason: dto.reason ?? 'Cancelled by user',
    });

    await this.orderRepository.save(updatedOrder);
    this.realtimeHub.publish({
      type: 'order:status-updated',
      room: `order:${updatedOrder.id}`,
      payload: this.toResponse(updatedOrder),
      occurredAt: new Date().toISOString(),
    });
    return this.toResponse(updatedOrder);
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
      customerId: dto.customerId,
      score: dto.score,
      comment: dto.comment,
      createdAt: now,
      updatedAt: now,
    });

    await this.orderRepository.save(ratedOrder);
    return this.toResponse(ratedOrder);
  }

  async getHistory(customerId?: string): Promise<OrderResponseDto[]> {
    return (await this.orderRepository.findByCustomerId(customerId ?? 'student-001')).map((order) => this.toResponse(order));
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
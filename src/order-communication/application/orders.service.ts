import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { RealtimeHubService } from '../../common/realtime-hub.service';
import { CommunicationService } from './communication.service';
import { ORDER_REPOSITORY } from './ports/order.repository';
import type { OrderRepository } from './ports/order.repository';
import { EVENT_PUBLISHER } from './ports/event-publisher';
import type { EventPublisher } from './ports/event-publisher';
import { IDENTITY_PORT } from './ports/identity.port';
import type { IdentityPort } from './ports/identity.port';
import { PRODUCTS_PORT } from './ports/products.port';
import type { ProductsPort } from './ports/products.port';
import { ORDER_EVENTS } from '../infrastructure/messaging/event-contracts';
import type {
  IncomingCartPricedEvent,
  IncomingReturnPricedEvent,
  IncomingStoreStatusChangedEvent,
  IncomingUserDeactivatedEvent,
} from '../infrastructure/messaging/event-contracts';
import { StoreDirectoryService } from './store-directory.service';
import {
  CreateOrderDto,
  CreateDraftDto,
  UpsertCartItemDto,
  RequestReturnDto,
  CancelOrderDto,
  FrequentProductDto,
  OrderResponseDto,
  RateOrderDto,
  UpdateOrderStatusDto,
} from './orders.dto';
import {
  attachRating,
  calculateAmounts,
  canTransitionOrder,
  CONFIRMED_OR_LATER,
  createHistoryEntry,
  Order,
  OrderActorType,
  OrderItem,
  OrderStatus,
  STOCK_RELEASING_STATUSES,
  transitionOrder,
} from '../domain/order.models';

/** Estados desde los que un pedido admite solicitar una devolución. */
const RETURNABLE_STATUSES: OrderStatus[] = [
  'CONFIRMED', 'READY_FOR_PICKUP', 'DELIVERED', 'PARTIALLY_RETURNED',
];

const PICKUP_WINDOW_MS = Number(process.env.PICKUP_WINDOW_HOURS ?? 2) * 3_600_000;
/** Minutos estimados de preparación, usados para el ETA cuando no hay hora programada. */
const PREP_TIME_MINUTES = Number(process.env.PREP_TIME_MINUTES ?? 15);

@Injectable()
export class OrdersService {
  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(IDENTITY_PORT) private readonly identity: IdentityPort,
    @Inject(PRODUCTS_PORT) private readonly products: ProductsPort,
    private readonly communicationService: CommunicationService,
    private readonly realtimeHub: RealtimeHubService,
    private readonly storeDirectory: StoreDirectoryService,
  ) {}

  /**
   * Bloquea la operación si la proyección local de identity sabe que la tienda está
   * cerrada. El chequeo síncrono contra identity sigue corriendo después como respaldo.
   */
  private assertStoreNotClosed(storeId: string): void {
    const cached = this.storeDirectory.isBlocked(storeId);
    if (cached.blocked) {
      throw new ConflictException(`La tienda no está disponible: ${cached.reason}`);
    }
  }

  async createOrder(dto: CreateOrderDto): Promise<OrderResponseDto> {
    if (!dto.items.length) {
      throw new BadRequestException('At least one item is required');
    }
    if (!dto.customerId) {
      throw new BadRequestException('customerId is required');
    }
    const customerId = dto.customerId;

    // 0) Idempotencia de creación: si ya existe un pedido con esta clave, lo devolvemos
    // tal cual (evita pedidos duplicados ante reintentos o doble clic).
    if (dto.idempotencyKey) {
      const existing = await this.orderRepository.findByIdempotencyKey(dto.idempotencyKey);
      if (existing) return this.toResponse(existing);
    }

    // 1) La tienda debe poder aceptar pedidos: primero la proyección local
    // (identity.store.status_changed) y luego el chequeo síncrono autoritativo
    // (incluye la hora de recogida programada, si la hay).
    this.assertStoreNotClosed(dto.storeId);
    const availability = await this.identity.getStoreAvailability(dto.storeId, dto.scheduledPickupAt);
    if (!availability.available) {
      throw new ConflictException(`La tienda no está disponible${availability.reason ? `: ${availability.reason}` : ''}`);
    }

    // 2) Validar productos/precios/stock (products-service; hoy mock).
    const validatedItems = await this.products.validateItems(dto.storeId, dto.items);

    const orderId = crypto.randomUUID();
    const resolvedItems = validatedItems.map((item) => ({
      id: crypto.randomUUID(),
      productId: item.productId,
      name: item.name,
      description: item.description,
      notes: item.notes,
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
      idempotencyKey: dto.idempotencyKey,
      scheduledPickupAt: dto.scheduledPickupAt,
      subtotalAmount: amounts.subtotalAmount,
      discountAmount,
      totalAmount: amounts.totalAmount,
      items: resolvedItems,
      statusHistory: [createHistoryEntry({ orderId, fromStatus: null, toStatus: 'CREATED', actorType: 'system' })],
      createdAt,
      updatedAt: createdAt,
    };

    try {
      await this.orderRepository.save(order);
    } catch (error) {
      // Carrera de idempotencia: otro request creó el pedido con la misma clave.
      if (dto.idempotencyKey && this.isUniqueViolation(error)) {
        const existing = await this.orderRepository.findByIdempotencyKey(dto.idempotencyKey);
        if (existing) return this.toResponse(existing);
      }
      throw error;
    }
    // Conversación comprador-vendedor del pedido (RF-09).
    await this.ensureConversation(order);
    // products-service reserva stock leyendo su proyección de carrito (cartId = orderId),
    // construida a partir de los eventos de carrito. En el path directo (sin checkout)
    // sembramos esa proyección aquí para que products pueda reservar stock igual que en
    // el flujo de carrito. orders no recotiza: products ignora el precio (usa el suyo) y
    // su `products.cart.priced` de respuesta se descarta porque el pedido ya no es DRAFT.
    await this.events.publish(ORDER_EVENTS.CART_CREATED, {
      cartId: order.id,
      buyerId: order.customerId,
      storeId: order.storeId,
      currency: order.currency,
    });
    await this.events.publish(ORDER_EVENTS.CART_ITEM_CHANGED, {
      cartId: order.id,
      storeId: order.storeId,
      currency: order.currency,
      items: order.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    });
    // Evento de creación: financial retiene el pago, products reserva stock, notifications avisa.
    await this.events.publish(ORDER_EVENTS.CREATED, {
      orderId: order.id,
      buyerId: order.customerId,
      storeId: order.storeId,
      totalAmount: order.totalAmount,
      paymentMethod: order.paymentMethod,
    });
    this.broadcast(order);

    // Efectivo (Option C): NO se confirma aquí. El pedido queda en CREATED hasta que
    // products-service reserve el stock de TODAS las líneas y publique
    // product.inventory.reservation_confirmed (lo maneja handleStockReservationConfirmed).
    // Así, ante la última unidad y dos compradores simultáneos, solo quien realmente
    // reserva el stock ve su pedido confirmado; el otro se cancela por reservation_rejected.
    // Pago digital: queda a la espera del resultado de financial-service.
    if (dto.paymentMethod !== 'cash') {
      const previous = order.status;
      order = this.transitionTo(order, 'PENDING_PAYMENT', 'payment', 'Awaiting payment approval');
      await this.finalize(previous, order);
    }

    return this.toResponse(order);
  }

  // ─── Carrito (orden DRAFT) ───────────────────────────────────────
  // El carrito vive aquí como una orden en estado DRAFT. orders NUNCA calcula
  // precios: solo guarda líneas (productId, quantity) y emite eventos; el precio
  // autoritativo y las promociones los resuelve products-service y vuelven por
  // `products.cart.priced`.

  /** Crea un carrito vacío para una tienda y avisa a products-service. */
  async createDraft(dto: CreateDraftDto): Promise<OrderResponseDto> {
    if (!dto.customerId) {
      throw new BadRequestException('customerId is required');
    }
    this.assertStoreNotClosed(dto.storeId);
    const availability = await this.identity.getStoreAvailability(dto.storeId, dto.scheduledPickupAt);
    if (!availability.available) {
      throw new ConflictException(`La tienda no está disponible${availability.reason ? `: ${availability.reason}` : ''}`);
    }

    const orderId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const currency = dto.currency ?? 'COP';
    const order: Order = {
      id: orderId,
      orderNumber: `OC-${createdAt.slice(0, 10).replaceAll('-', '')}-${Math.floor(Math.random() * 9000 + 1000)}`,
      customerId: dto.customerId,
      storeId: dto.storeId,
      storeName: dto.storeName,
      status: 'DRAFT',
      paymentMethod: dto.paymentMethod,
      deliveryMethod: dto.deliveryMethod,
      currency,
      source: dto.source ?? 'web',
      notes: dto.notes,
      scheduledPickupAt: dto.scheduledPickupAt,
      subtotalAmount: 0,
      discountAmount: 0,
      totalAmount: 0,
      items: [],
      statusHistory: [createHistoryEntry({ orderId, fromStatus: null, toStatus: 'DRAFT', actorType: 'customer', actorId: dto.customerId })],
      createdAt,
      updatedAt: createdAt,
    };

    await this.orderRepository.save(order);
    await this.events.publish(ORDER_EVENTS.CART_CREATED, {
      cartId: order.id,
      buyerId: order.customerId,
      storeId: order.storeId,
      currency,
    });
    this.broadcast(order);
    return this.toResponse(order);
  }

  /** Añade, actualiza (cantidad) o elimina (cantidad 0) una línea del carrito. */
  async setCartItem(id: string, dto: UpsertCartItemDto): Promise<OrderResponseDto> {
    const order = await this.requireOrder(id);
    if (order.status !== 'DRAFT') {
      throw new ConflictException('Solo se puede modificar un carrito en estado DRAFT');
    }

    const items = [...order.items];
    const index = items.findIndex((item) => item.productId === dto.productId);
    if (dto.quantity <= 0) {
      if (index >= 0) items.splice(index, 1);
    } else if (index >= 0) {
      items[index] = {
        ...items[index],
        quantity: dto.quantity,
        name: dto.name ?? items[index].name,
        notes: dto.notes ?? items[index].notes,
        imageUrl: dto.imageUrl ?? items[index].imageUrl,
      };
    } else {
      items.push({
        id: crypto.randomUUID(),
        productId: dto.productId,
        name: dto.name ?? 'Producto',
        notes: dto.notes,
        imageUrl: dto.imageUrl,
        unitPrice: 0, // se completa cuando products cotiza el carrito
        quantity: dto.quantity,
        totalAmount: 0,
      });
    }

    // Los montos se mantienen hasta que llegue products.cart.priced.
    const updated = await this.orderRepository.replaceItems(order.id, items, {
      subtotalAmount: order.subtotalAmount,
      discountAmount: order.discountAmount,
      totalAmount: order.totalAmount,
    });
    await this.events.publish(ORDER_EVENTS.CART_ITEM_CHANGED, {
      cartId: order.id,
      storeId: order.storeId,
      currency: order.currency,
      items: updated.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    });
    this.broadcast(updated);
    return this.toResponse(updated);
  }

  /** Aplica la cotización autoritativa de products-service al carrito DRAFT. */
  async applyCartPriced(event: IncomingCartPricedEvent): Promise<void> {
    const order = await this.orderRepository.findById(event.cartId);
    if (!order || order.status !== 'DRAFT') return;

    const items: OrderItem[] = event.lines.map((line) => {
      const existing = order.items.find((item) => item.productId === line.productId);
      return {
        id: existing?.id ?? crypto.randomUUID(),
        productId: line.productId,
        name: line.name,
        notes: existing?.notes, // products no maneja notas; preservamos la del comprador
        imageUrl: line.imageUrl,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        totalAmount: line.totalAmount,
      };
    });

    const updated = await this.orderRepository.replaceItems(order.id, items, {
      subtotalAmount: event.subtotalAmount,
      discountAmount: event.discountAmount,
      totalAmount: event.finalAmount,
    });
    this.broadcast(updated);
  }

  /** Confirma el carrito: lo pasa a pago y dispara el cobro en financial. */
  async checkout(id: string): Promise<OrderResponseDto> {
    let order = await this.requireOrder(id);
    if (order.status !== 'DRAFT') {
      throw new ConflictException('El pedido no es un carrito en estado DRAFT');
    }
    if (order.items.length === 0) {
      throw new BadRequestException('El carrito está vacío');
    }
    if (order.totalAmount <= 0) {
      throw new ConflictException('El carrito aún no ha sido cotizado por products-service');
    }

    // El carrito (DRAFT) no creó conversación; al confirmarse el pedido la creamos aquí
    // para que el chat comprador-vendedor exista y el vendedor reciba el pedido (RF-09).
    await this.ensureConversation(order);

    await this.events.publish(ORDER_EVENTS.CREATED, {
      orderId: order.id,
      buyerId: order.customerId,
      storeId: order.storeId,
      totalAmount: order.totalAmount,
      paymentMethod: order.paymentMethod,
    });

    const previous = order.status;
    if (order.paymentMethod === 'cash') {
      // Option C: pasa a CREATED y espera reservation_confirmed antes de CONFIRMED.
      order = this.transitionTo(order, 'CREATED', 'system', 'Awaiting stock reservation');
    } else {
      order = this.transitionTo(order, 'PENDING_PAYMENT', 'payment', 'Awaiting payment approval');
    }
    await this.finalize(previous, order);
    return this.toResponse(order);
  }

  // ─── Devoluciones ────────────────────────────────────────────────

  /** Solicita una devolución (total o parcial). products calcula el monto. */
  async requestReturn(id: string, dto: RequestReturnDto): Promise<OrderResponseDto> {
    const order = await this.requireOrder(id);
    if (!RETURNABLE_STATUSES.includes(order.status)) {
      throw new ConflictException(`La orden en estado ${order.status} no admite devoluciones`);
    }
    const full = dto.full ?? !dto.items?.length;
    if (!full && !dto.items?.length) {
      throw new BadRequestException('Indica los productos a devolver o solicita una devolución total');
    }

    await this.events.publish(ORDER_EVENTS.RETURN_REQUESTED, {
      orderId: order.id,
      storeId: order.storeId,
      full,
      items: full ? undefined : dto.items?.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      reason: dto.reason,
    });
    // El estado se actualiza al llegar products.return.priced.
    return this.toResponse(order);
  }

  /**
   * Aplica la devolución cotizada por products: marca la orden devuelta y, como
   * dueña del pedido, AUTORIZA el reembolso emitiendo `order.return.confirmed` para
   * que financial acredite la billetera. orders no calcula el monto: solo reenvía el
   * que cotizó products.
   */
  async applyReturnPriced(event: IncomingReturnPricedEvent): Promise<void> {
    const order = await this.orderRepository.findById(event.orderId);
    if (!order) return;
    if (event.refundAmount <= 0) return;
    const toStatus: OrderStatus = event.full ? 'RETURNED' : 'PARTIALLY_RETURNED';
    if (!canTransitionOrder(order.status, toStatus)) return;

    const updated = this.transitionTo(
      order,
      toStatus,
      'system',
      `Devolución por ${event.refundAmount} centavos`,
    );
    await this.finalize(order.status, updated);

    await this.events.publish(ORDER_EVENTS.RETURN_CONFIRMED, {
      orderId: order.id,
      buyerId: order.customerId,
      storeId: order.storeId,
      full: event.full,
      refundAmount: event.refundAmount,
    });
  }

  async getOrders(query?: { customerId?: string; storeId?: string; status?: string }): Promise<OrderResponseDto[]> {
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
    // Validar la transición ANTES de transicionar: un cambio inválido es un error del
    // cliente (409), no un 500. Sin esto, transitionOrder lanza un Error genérico.
    if (!canTransitionOrder(order.status, dto.status)) {
      throw new ConflictException(`Transición inválida: ${order.status} → ${dto.status}`);
    }
    const previous = order.status;
    const updated = this.transitionTo(order, dto.status, dto.actorType as OrderActorType, dto.reason, dto.actorId);
    await this.finalize(previous, updated);
    return this.toResponse(updated);
  }

  async cancelOrder(id: string, dto: CancelOrderDto): Promise<OrderResponseDto> {
    const order = await this.requireOrder(id);
    // Un pedido entregado/cancelado/devuelto (estado terminal) no admite cancelación.
    if (!canTransitionOrder(order.status, 'CANCELLED')) {
      throw new ConflictException(`No se puede cancelar un pedido en estado ${order.status}`);
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

  /**
   * product.inventory.reservation_rejected -> CANCELLED.
   * products-service no pudo reservar stock para una línea: no quedan pedidos
   * parciales, se cancela la orden completa (igual que un QR expirado o un pago
   * fallido) para no dejarla en un estado intermedio sin inventario garantizado.
   */
  async handleStockReservationRejected(orderId: string, reason?: string): Promise<void> {
    const order = await this.orderRepository.findById(orderId);
    if (!order || !canTransitionOrder(order.status, 'CANCELLED')) return;
    const cancelled = this.transitionTo(
      order,
      'CANCELLED',
      'system',
      reason ?? 'No había stock disponible para completar el pedido',
    );
    await this.finalize(order.status, cancelled);
  }

  /**
   * product.inventory.reservation_confirmed -> CONFIRMED (solo pedidos en efectivo).
   * products-service reservó stock para TODAS las líneas del pedido. Recién entonces un
   * pedido en efectivo (que no pasa por pago digital) puede pasar a CONFIRMED: así, ante
   * la última unidad y dos compradores simultáneos, solo quien realmente reservó el stock
   * ve su pedido confirmado; el otro se cancela por reservation_rejected (Option C).
   * Los pedidos con pago digital ignoran este evento: los confirma el pago
   * (applyPaymentApproved); cuando llega ya no están en CREATED, así que el guard los salta.
   */
  async handleStockReservationConfirmed(orderId: string): Promise<void> {
    const order = await this.orderRepository.findById(orderId);
    if (!order) return;
    if (order.paymentMethod !== 'cash') return;
    // Solo desde CREATED: si ya avanzó (CONFIRMED, CANCELLED, ...) no hay nada que hacer.
    if (order.status !== 'CREATED') return;
    const confirmed = this.transitionTo(order, 'CONFIRMED', 'fulfillment', 'Stock reserved; cash order confirmed');
    await this.finalize(order.status, confirmed);
  }

  // ─── Eventos de identity-service ─────────────────────────────────

  /** identity.store.status_changed -> actualiza la proyección local de estado de tienda. */
  applyStoreStatusChanged(event: IncomingStoreStatusChangedEvent): void {
    this.storeDirectory.applyStatusChanged(event.storeId, event.newStatus, event.reason);
  }

  /** identity.user.deactivated -> revoca las sesiones WebSocket activas del usuario. */
  handleUserDeactivated(event: IncomingUserDeactivatedEvent): void {
    if (!event.userId) return;
    // El gateway escucha este evento del hub y desconecta los sockets del usuario.
    this.realtimeHub.publish({
      type: 'session:revoked',
      payload: { userId: event.userId, reason: event.reason },
      occurredAt: new Date().toISOString(),
    });
  }

  // ─── helpers ────────────────────────────────────────────────

  /** Detecta una violación de restricción única de Postgres (código 23505). */
  private isUniqueViolation(error: unknown): boolean {
    const e = error as { code?: string; driverError?: { code?: string } };
    return e?.code === '23505' || e?.driverError?.code === '23505';
  }

  /** ETA: hora programada si existe; si no, createdAt + minutos de preparación. */
  private estimatedReadyAt(order: Order): string {
    if (order.scheduledPickupAt) return order.scheduledPickupAt;
    return new Date(new Date(order.createdAt).getTime() + PREP_TIME_MINUTES * 60_000).toISOString();
  }

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
    // Persistencia segura ante concurrencia: solo aplica si el pedido sigue en
    // `previousStatus`. Si otro proceso ya lo cambió, abortamos sin pisar el estado.
    const saved = await this.orderRepository.saveTransition(order, previousStatus);
    if (!saved) {
      throw new ConflictException(
        `El pedido ${order.id} cambió de estado de forma concurrente (se esperaba ${previousStatus})`,
      );
    }
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
    // CANCELLED y FAILED son equivalentes para products-service: en ambos casos la
    // venta no se concreta y hay que liberar/restituir el stock reservado. Se
    // publica el mismo evento `order.order.cancelled` para los dos; el guard de
    // `previousStatus` evita liberar dos veces si una orden FAILED se cancela
    // después (transición válida: FAILED -> CANCELLED).
    if (STOCK_RELEASING_STATUSES.has(order.status) && !STOCK_RELEASING_STATUSES.has(previousStatus)) {
      // wasSold: si la orden ya había pasado por CONFIRMED, confirmReservation ya
      // descontó el stock físico (venta concretada) y dejó reservedStock en 0.
      // products-service necesita saberlo para devolver la unidad a `stock`
      // (restock) en vez de solo soltar una reserva que ya no existe.
      await this.events.publish(ORDER_EVENTS.CANCELLED, {
        orderId: order.id,
        buyerId: order.customerId,
        wasSold: CONFIRMED_OR_LATER.has(previousStatus),
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

  /**
   * Garantiza que exista la conversación comprador-vendedor del pedido (RF-09) y avisa
   * al vendedor en tiempo real. Resuelve el `vendorId` real desde identity (primer staff
   * activo de la tienda) y cae al `storeId` como aproximación si identity no lo expone.
   * Idempotente: `ensureConversationForOrder` reutiliza la conversación si ya existe.
   */
  private async ensureConversation(order: Order): Promise<void> {
    const vendorId = (await this.identity.getStoreVendorId(order.storeId)) ?? order.storeId;
    await this.communicationService.ensureConversationForOrder({
      orderId: order.id,
      storeId: order.storeId,
      customerId: order.customerId,
      vendorId,
    });
    // Empuja el pedido a la sala personal del vendedor para que su panel de pedidos
    // entrantes lo muestre en vivo sin recargar (el gateway une cada socket a `user:<id>`).
    this.realtimeHub.publish({
      type: 'order:new',
      room: `user:${vendorId}`,
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
      scheduledPickupAt: order.scheduledPickupAt,
      estimatedReadyAt: this.estimatedReadyAt(order),
      pickupExpiresAt: order.pickupExpiresAt,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      cancelledAt: order.cancelledAt,
    };
  }
}

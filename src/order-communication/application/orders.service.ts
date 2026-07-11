import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { RealtimeHubService } from '../../common/realtime-hub.service';
import { CommunicationService } from './communication.service';
import { ORDER_REPOSITORY } from './ports/order.repository';
import type { OrderRepository } from './ports/order.repository';
import { EVENT_PUBLISHER } from './ports/event-publisher';
import type { EventPublisher } from './ports/event-publisher';
import { IDENTITY_PORT } from './ports/identity.port';
import type { IdentityPort } from './ports/identity.port';
import { PRODUCTS_PORT } from './ports/products.port';
import type { ProductsPort, QuotedItem } from './ports/products.port';
import { FINANCIAL_PORT } from './ports/financial.port';
import type { FinancialPort } from './ports/financial.port';
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
  QuoteCartDto,
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

/** Resultado del paso "Confirmar": factura cotizada (precio con promos + stock por línea). */
export interface CartQuoteResult {
  cartId: string;
  orderNumber: string;
  storeName: string;
  currency: string;
  lines: QuotedItem[];
  subtotalAmount: number;
  discountAmount: number;
  /** Recargo de hora pico que cobra la tienda al comprador, en centavos COP (0 si no aplica). */
  peakFeeAmount: number;
  /** true si al cotizar la tienda está en su franja de hora pico. */
  isPeakHour: boolean;
  /** Total a pagar = subtotal − descuento + recargo de hora pico. */
  totalAmount: number;
  hasStockIssues: boolean;
}

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
    @Inject(FINANCIAL_PORT) private readonly financial: FinancialPort,
    private readonly communicationService: CommunicationService,
    private readonly realtimeHub: RealtimeHubService,
    private readonly storeDirectory: StoreDirectoryService,
  ) {}

  private readonly logger = new Logger(OrdersService.name);

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
      stockReserved: false,
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
    // Avisa al vendedor en vivo del pedido entrante (el chat, RF-09, se abre luego, al confirmarse).
    await this.notifyVendorNewOrder(order);
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
    // Fija el recargo de hora pico y lo suma al precio de la orden (igual que en el checkout
    // del carrito): financial cobra EXACTAMENTE este total sin recalcular el pico.
    const orderAmount = order.totalAmount; // base: valor de los productos
    const commission = await this.financial.getCommission(order.storeId, orderAmount);
    const grandTotal = orderAmount + commission.peakFeeAmount;
    order = { ...order, totalAmount: grandTotal };

    // Evento de creación: financial retiene el pago, products reserva stock, notifications avisa.
    await this.events.publish(ORDER_EVENTS.CREATED, {
      orderId: order.id,
      buyerId: order.customerId,
      storeId: order.storeId,
      orderAmount,
      peakFeeAmount: commission.peakFeeAmount,
      isPeakHour: commission.isPeakHour,
      totalAmount: grandTotal,
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
      stockReserved: false,
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

  /**
   * NO-OP intencional. El carrito ahora se cotiza de forma SÍNCRONA en `quoteCart` (paso
   * "Confirmar", REST a products), así que orders ya NO aplica el `products.cart.priced`
   * asíncrono al DRAFT.
   *
   * Por qué se desactivó: escribir aquí el array de items del pedido lo convertía en un SEGUNDO
   * escritor concurrente junto a `setCartItem`. Ambos hacen lectura-modificación-escritura del
   * array completo (`replaceItems`) sin bloqueo, así que un `cart.priced` que leía el pedido antes
   * de un `setCartItem` y escribía después PISABA ese cambio (lost update), dejando `order.items`
   * atrasado respecto al carrito del usuario. Con la cotización síncrona ya no hace falta este
   * camino, y quitándolo `order.items` queda con un único escritor (`setCartItem`, serializado en
   * el cliente) y deja de desincronizarse. products sigue manteniendo su proyección `cart_lines`
   * con el mismo evento para reservar stock en el checkout.
   */
  async applyCartPriced(_event: IncomingCartPricedEvent): Promise<void> {
    // Intencionalmente vacío: ver el docblock. La cotización del DRAFT es síncrona (quoteCart).
    return;
  }

  /**
   * Cotiza el carrito de forma SÍNCRONA para el paso "Confirmar" (antes de mostrar la factura
   * y habilitar el pago). Precio autoritativo con promociones vía products (REST) y chequeo de
   * stock por línea SIN cobrar ni reservar. Persiste los precios en el DRAFT para que el
   * posterior `checkout` no dependa de la cotización asíncrona por eventos. El botón del front
   * deja así de esperar `products.cart.priced`.
   */
  async quoteCart(id: string, dto: QuoteCartDto): Promise<CartQuoteResult> {
    const order = await this.requireOrder(id);
    if (order.status !== 'DRAFT') {
      throw new ConflictException('El pedido no es un carrito en estado DRAFT');
    }
    if (!dto.items.length) {
      throw new BadRequestException('El carrito está vacío');
    }

    // Fuente de verdad: las cantidades que envía el front (lo que el usuario ve). NO confiamos en
    // `order.items`, que pudo quedar atrás por escrituras incrementales perdidas/desordenadas.
    // Cotizamos exactamente ese conjunto y luego lo FIJAMOS en el pedido, reparando cualquier
    // drift previo, de modo que el modal/factura siempre coincida con el carrito.
    const quoted = await this.products.quoteItems(
      order.storeId,
      dto.items.map((item) => ({
        productId: item.productId,
        name: item.name ?? 'Producto',
        imageUrl: item.imageUrl,
        unitPrice: 0, // products calcula el precio autoritativo; el del cliente se ignora
        quantity: item.quantity,
      })),
    );

    const subtotalAmount = quoted.reduce((sum, q) => sum + q.listUnitPrice * q.quantity, 0);
    // Valor de los productos ya con promoción (base del pedido). Es lo que se persiste y lo que
    // financial recibe como `orderAmount` al cobrar; el recargo de hora pico se calcula SOBRE él.
    const productsTotal = quoted.reduce((sum, q) => sum + q.totalAmount, 0);
    const discountAmount = Math.max(0, subtotalAmount - productsTotal);

    // Comisión de hora pico (financial es la fuente de verdad). Se suma SOLO al total mostrado en
    // la factura; NO se persiste en el pedido, porque financial la vuelve a calcular sobre
    // `orderAmount` al procesar `order.created` y, si la persistiéramos, se cobraría dos veces.
    const commission = await this.financial.getCommission(order.storeId, productsTotal);
    const totalAmount = productsTotal + commission.peakFeeAmount;

    // Persistimos el precio autoritativo Y el conjunto exacto de líneas en el DRAFT: así `checkout`
    // ve totalAmount > 0 y `order.items` queda idéntico al carrito, sin depender de eventos.
    const items: OrderItem[] = quoted.map((q) => {
      const existing = order.items.find((it) => it.productId === q.productId);
      return {
        id: existing?.id ?? crypto.randomUUID(),
        productId: q.productId,
        name: q.name,
        notes: existing?.notes,
        imageUrl: q.imageUrl,
        unitPrice: q.unitPrice,
        quantity: q.quantity,
        totalAmount: q.totalAmount,
      };
    });
    const updated = await this.orderRepository.replaceItems(order.id, items, {
      subtotalAmount,
      discountAmount,
      // Se persiste el valor de los productos (SIN recargo de hora pico): es la base que
      // financial cobra y sobre la que recalcula el recargo. Ver comentario arriba.
      totalAmount: productsTotal,
    });
    // Sincroniza la proyección de products (cart_lines) con el conjunto final, para que la reserva
    // de stock en el checkout use exactamente estas líneas aunque alguna escritura incremental se
    // hubiera perdido.
    await this.events.publish(ORDER_EVENTS.CART_ITEM_CHANGED, {
      cartId: order.id,
      storeId: order.storeId,
      currency: order.currency,
      items: updated.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    });
    this.broadcast(updated);

    return {
      cartId: order.id,
      orderNumber: order.orderNumber,
      storeName: order.storeName,
      currency: order.currency,
      lines: quoted,
      subtotalAmount,
      discountAmount,
      peakFeeAmount: commission.peakFeeAmount,
      isPeakHour: commission.isPeakHour,
      totalAmount,
      hasStockIssues: quoted.some((q) => !q.hasStock),
    };
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

    // Avisa al vendedor en vivo del pedido entrante (el chat, RF-09, se abre luego, al confirmarse).
    await this.notifyVendorNewOrder(order);

    // Fija el recargo de hora pico AHORA (financial es la fuente de verdad) y lo suma al precio
    // de la orden: lo que se cobra y lo que queda registrado incluye la comisión de hora pico,
    // no solo el valor de los productos. Se envía el desglose para que financial cobre EXACTAMENTE
    // este total sin recalcular el pico (el precio que vio el comprador == el precio cobrado).
    const orderAmount = order.totalAmount; // base: valor de los productos (ya con promociones)
    const commission = await this.financial.getCommission(order.storeId, orderAmount);
    const grandTotal = orderAmount + commission.peakFeeAmount;

    await this.events.publish(ORDER_EVENTS.CREATED, {
      orderId: order.id,
      buyerId: order.customerId,
      storeId: order.storeId,
      orderAmount,
      peakFeeAmount: commission.peakFeeAmount,
      isPeakHour: commission.isPeakHour,
      totalAmount: grandTotal,
      paymentMethod: order.paymentMethod,
    });

    // El precio de la orden pasa a ser el total con hora pico (se persiste al finalizar).
    order = { ...order, totalAmount: grandTotal };

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

  /**
   * financial.payment.processed -> PAYMENT_APPROVED (pago retenido). NO confirma aquí:
   * un pedido digital solo pasa a CONFIRMED cuando ADEMÁS products-service reservó el
   * stock (reservation_confirmed). Así se cierra la sobreventa en pagos digitales —
   * antes el pago confirmaba la orden sin mirar el inventario, y ante la última unidad
   * (o varias) los dos compradores quedaban confirmados. La confirmación efectiva la
   * dispara confirmIfPaidAndReserved, que también corre desde handleStockReservationConfirmed
   * (los dos eventos llegan sin orden garantizado; ver stock_reserved en la orden).
   */
  async applyPaymentApproved(orderId: string): Promise<void> {
    const order = await this.orderRepository.findById(orderId);
    if (!order || order.status !== 'PENDING_PAYMENT') return;
    const approved = this.transitionTo(order, 'PAYMENT_APPROVED', 'payment', 'Payment held by financial-service');
    await this.finalize(order.status, approved);
    // Pago listo: confirma solo si la reserva de stock ya llegó; si no, espera a
    // reservation_confirmed (que reintentará esta misma comprobación).
    await this.confirmIfPaidAndReserved(orderId);
  }

  /**
   * Confirma un pedido DIGITAL solo cuando se cumplen AMBAS condiciones: pago aprobado
   * (status = PAYMENT_APPROVED) y stock reservado (stockReserved = true). Idempotente y
   * seguro ante concurrencia: relee el estado fresco (para ver la señal que publicó el
   * otro handler) y la transición a CONFIRMED va con compare-and-set en finalize, de modo
   * que si ambos handlers corren a la vez solo uno gana y el otro aborta sin efecto.
   */
  private async confirmIfPaidAndReserved(orderId: string): Promise<void> {
    const order = await this.orderRepository.findById(orderId);
    if (!order) return;
    if (order.paymentMethod === 'cash') return; // efectivo confirma vía Option C, no por pago
    if (order.status !== 'PAYMENT_APPROVED') return; // pago aún no aprobado, o ya avanzó
    if (!order.stockReserved) return; // reserva de stock aún no confirmada
    const confirmed = this.transitionTo(order, 'CONFIRMED', 'payment', 'Payment captured; stock reserved');
    try {
      await this.finalize(order.status, confirmed);
    } catch (error) {
      // El otro handler (pago/reserva) ganó la carrera y ya confirmó: no es un error.
      if (!(error instanceof ConflictException)) throw error;
    }
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
   * product.inventory.reservation_confirmed: products-service reservó stock para TODAS
   * las líneas del pedido. Recién con stock realmente reservado un pedido puede confirmarse.
   *
   * - EFECTIVO (Option C): confirma directo (CREATED -> CONFIRMED). No hay pago digital,
   *   así que la reserva es la única condición.
   * - DIGITAL (wallet/tarjeta): NO confirma solo con la reserva; marca stockReserved y
   *   confirma únicamente si el pago ya fue aprobado (confirmIfPaidAndReserved). Antes este
   *   evento se ignoraba para pedidos digitales y el pago confirmaba solo → sobreventa con
   *   la última unidad o con varias. Como reservation_confirmed y payment.processed llegan
   *   sin orden garantizado, se persiste la señal para no depender de cuál llegue primero.
   */
  async handleStockReservationConfirmed(orderId: string): Promise<void> {
    const order = await this.orderRepository.findById(orderId);
    if (!order) return;

    if (order.paymentMethod === 'cash') {
      // Solo desde CREATED: si ya avanzó (CONFIRMED, CANCELLED, ...) no hay nada que hacer.
      if (order.status !== 'CREATED') return;
      const confirmed = this.transitionTo(order, 'CONFIRMED', 'fulfillment', 'Stock reserved; cash order confirmed');
      await this.finalize(order.status, confirmed);
      return;
    }

    // Digital: persiste la reserva y confirma si el pago ya está aprobado; si no, espera
    // a applyPaymentApproved (que reintentará confirmIfPaidAndReserved).
    await this.orderRepository.markStockReserved(orderId);
    await this.confirmIfPaidAndReserved(orderId);
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
      // Chat comprador-vendedor (RF-09): se abre justo aquí, no antes. Antes de CONFIRMED
      // el pedido puede no llegar a concretarse (falla el pago, no hay stock) y no tiene
      // sentido mostrarle un chat "en el limbo" a ninguno de los 2 lados.
      await this.ensureConversation(order);
    }
    // El chat se cierra para siempre al entregar o cancelar (ninguno de los 2 lados debe
    // volver a verlo). No-op si el pedido nunca llegó a CONFIRMED (nunca tuvo chat).
    if ((order.status === 'DELIVERED' || order.status === 'CANCELLED') && previousStatus !== order.status) {
      await this.communicationService.closeConversationForOrder(order.id);
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
   * Avisa al vendedor en tiempo real de un pedido entrante, apenas se crea (antes de
   * confirmarse). Resuelve el `vendorId` real desde identity (primer staff activo de la
   * tienda) y cae al `storeId` como aproximación si identity no lo expone.
   */
  private async notifyVendorNewOrder(order: Order): Promise<void> {
    const vendorId = (await this.identity.getStoreVendorId(order.storeId)) ?? order.storeId;
    // Empuja el pedido a la sala personal del vendedor para que su panel de pedidos
    // entrantes lo muestre en vivo sin recargar (el gateway une cada socket a `user:<id>`).
    this.realtimeHub.publish({
      type: 'order:new',
      room: `user:${vendorId}`,
      payload: this.toResponse(order),
      occurredAt: new Date().toISOString(),
    });
  }

  /**
   * Crea la conversación comprador-vendedor del pedido (RF-09) al confirmarse. Resuelve
   * el `vendorId` real desde identity (primer staff activo de la tienda) y cae al
   * `storeId` como aproximación si identity no lo expone. Idempotente:
   * `ensureConversationForOrder` reutiliza la conversación si ya existe.
   */
  private async ensureConversation(order: Order): Promise<void> {
    try {
      const vendorId = (await this.identity.getStoreVendorId(order.storeId)) ?? order.storeId;
      this.logger.log(`[chat] Creando/asegurando conversación para pedido ${order.id} (store=${order.storeId}, customer=${order.customerId}, vendor=${vendorId})`);
      const conv = await this.communicationService.ensureConversationForOrder({
        orderId: order.id,
        storeId: order.storeId,
        customerId: order.customerId,
        vendorId,
        storeName: order.storeName,
      });
      this.logger.log(`[chat] Conversación lista ${conv.id} para pedido ${order.id} (store="${conv.storeName ?? ''}", customer="${conv.customerName ?? ''}")`);
    } catch (error) {
      // El chat no debe tumbar la confirmación del pedido: si falla, se registra y el
      // pedido queda confirmado igual. Antes este error se perdía en silencio.
      this.logger.error(`[chat] No se pudo crear la conversación del pedido ${order.id}: ${(error as Error).message}`, (error as Error).stack);
    }
  }

  private async requireOrder(id: string): Promise<Order> {
    const order = await this.orderRepository.findById(id);
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return order;
  }

  /** Elimina físicamente un pedido (solo DELIVERED, CANCELLED o FAILED). */
  async deleteOrder(id: string): Promise<void> {
    const order = await this.requireOrder(id);
    if (!['DELIVERED', 'CANCELLED', 'FAILED'].includes(order.status)) {
      throw new ConflictException('Solo se pueden eliminar pedidos entregados, cancelados o fallidos');
    }
    await this.orderRepository.delete(id);
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

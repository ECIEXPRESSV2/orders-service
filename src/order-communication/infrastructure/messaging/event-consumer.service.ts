import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrdersService } from '../../application/orders.service';
import { ProcessedEventEntity } from '../persistence/processed-event.entity';
import { ServiceBusService } from './service-bus.service';
import {
  CONSUMED_EVENTS,
  CONSUMED_ROUTING_KEYS,
  IncomingEventEnvelope,
  type IncomingCartPricedEvent,
  type IncomingReturnPricedEvent,
  type IncomingStoreStatusChangedEvent,
  type IncomingUserDeactivatedEvent,
} from './event-contracts';

/**
 * Consume eventos de fulfillment y financial desde RabbitMQ y los traduce a
 * transiciones de pedido. El consumo es idempotente: cada idempotencyKey se
 * registra en `processed_events` para no aplicar dos veces el mismo evento.
 */
@Injectable()
export class EventConsumerService implements OnModuleInit {
  private readonly logger = new Logger(EventConsumerService.name);

  constructor(
    private readonly rabbit: ServiceBusService,
    private readonly ordersService: OrdersService,
    @InjectRepository(ProcessedEventEntity)
    private readonly processed: Repository<ProcessedEventEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.rabbit.consume(CONSUMED_ROUTING_KEYS, (routingKey, content) =>
        this.handle(routingKey, content as IncomingEventEnvelope),
      );
    } catch (error) {
      this.logger.error(`No se pudo iniciar el consumer: ${(error as Error).message}`);
    }
  }

  private async handle(routingKey: string, event: IncomingEventEnvelope): Promise<void> {
    // Eventos de products: se aplican SIEMPRE (la cotización es un reemplazo
    // completo e idempotente) y no usan el orderId/idempotencyKey del envelope de
    // orders, así que se procesan antes del guard y la deduplicación.
    if (routingKey === CONSUMED_EVENTS.CART_PRICED) {
      await this.ordersService.applyCartPriced(event as unknown as IncomingCartPricedEvent);
      this.logger.log(`Carrito cotizado aplicado: cart ${(event as { cartId?: string }).cartId}`);
      return;
    }
    if (routingKey === CONSUMED_EVENTS.RETURN_PRICED) {
      await this.ordersService.applyReturnPriced(event as unknown as IncomingReturnPricedEvent);
      this.logger.log(`Devolución aplicada: order ${event.orderId}`);
      return;
    }

    // Eventos de identity: no traen orderId. Son idempotentes por naturaleza
    // (actualizan una proyección / revocan sesiones), así que se aplican siempre.
    if (routingKey === CONSUMED_EVENTS.STORE_STATUS_CHANGED) {
      this.ordersService.applyStoreStatusChanged(event as unknown as IncomingStoreStatusChangedEvent);
      return;
    }
    if (routingKey === CONSUMED_EVENTS.USER_DEACTIVATED) {
      this.ordersService.handleUserDeactivated(event as unknown as IncomingUserDeactivatedEvent);
      this.logger.log(`Usuario desactivado: sesiones revocadas (${(event as { userId?: string }).userId})`);
      return;
    }

    const orderId = event.orderId;
    if (!orderId) {
      this.logger.warn(`Evento ${routingKey} sin orderId; ignorado`);
      return;
    }

    // Idempotencia: si ya procesamos este idempotencyKey, no repetir.
    const key = event.idempotencyKey ?? `${routingKey}:${orderId}`;
    const already = await this.processed.findOne({ where: { idempotencyKey: key } });
    if (already) {
      this.logger.debug(`Evento ${key} ya procesado; omitido`);
      return;
    }

    switch (routingKey) {
      case CONSUMED_EVENTS.PAYMENT_PROCESSED:
        await this.ordersService.applyPaymentApproved(orderId);
        break;
      case CONSUMED_EVENTS.PAYMENT_FAILED:
        await this.ordersService.applyPaymentFailed(orderId, event.reason);
        break;
      case CONSUMED_EVENTS.DELIVERY_CONFIRMED:
        await this.ordersService.markDelivered(orderId);
        break;
      case CONSUMED_EVENTS.DELIVERY_FAILED:
        await this.ordersService.markFailed(orderId, event.reason);
        break;
      case CONSUMED_EVENTS.QR_EXPIRED:
        await this.ordersService.handleQrExpired(orderId);
        break;
      case CONSUMED_EVENTS.RESERVATION_REJECTED:
        await this.ordersService.handleStockReservationRejected(orderId, event.reason);
        break;
      default:
        this.logger.warn(`Routing key no manejada: ${routingKey}`);
        return;
    }

    await this.processed.save(this.processed.create({ idempotencyKey: key, routingKey }));
    this.logger.log(`Evento aplicado: ${routingKey} (order ${orderId})`);
  }
}

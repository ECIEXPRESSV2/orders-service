import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrdersService } from '../../application/orders.service';
import { ProcessedEventEntity } from '../persistence/processed-event.entity';
import { RabbitMQService } from './rabbitmq.service';
import { CONSUMED_EVENTS, CONSUMED_ROUTING_KEYS, IncomingEventEnvelope } from './event-contracts';

/**
 * Consume eventos de fulfillment y financial desde RabbitMQ y los traduce a
 * transiciones de pedido. El consumo es idempotente: cada idempotencyKey se
 * registra en `processed_events` para no aplicar dos veces el mismo evento.
 */
@Injectable()
export class EventConsumerService implements OnModuleInit {
  private readonly logger = new Logger(EventConsumerService.name);

  constructor(
    private readonly rabbit: RabbitMQService,
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
      default:
        this.logger.warn(`Routing key no manejada: ${routingKey}`);
        return;
    }

    await this.processed.save(this.processed.create({ idempotencyKey: key, routingKey }));
    this.logger.log(`Evento aplicado: ${routingKey} (order ${orderId})`);
  }
}

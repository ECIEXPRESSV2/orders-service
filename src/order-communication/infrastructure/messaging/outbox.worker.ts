import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { OutboxEventEntity } from '../persistence/outbox-event.entity';
import { ServiceBusService } from './service-bus.service';

const POLL_MS = 5_000;
const BATCH_SIZE = 50;
const MAX_RETRIES = 5;

/**
 * Worker que publica los eventos PENDING del outbox a RabbitMQ. Reintenta con
 * tope de MAX_RETRIES; si se supera, marca el evento como FAILED.
 */
@Injectable()
export class OutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectRepository(OutboxEventEntity)
    private readonly outbox: Repository<OutboxEventEntity>,
    private readonly rabbit: ServiceBusService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), POLL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const pending = await this.outbox.find({
        where: { status: 'PENDING', retryCount: LessThanOrEqual(MAX_RETRIES) },
        order: { createdAt: 'ASC' },
        take: BATCH_SIZE,
      });

      for (const event of pending) {
        try {
          await this.rabbit.publish(event.routingKey, event.payload);
          event.status = 'PUBLISHED';
          event.publishedAt = new Date();
          event.lastError = null;
          await this.outbox.save(event);
        } catch (error) {
          event.retryCount += 1;
          event.lastError = (error as Error).message;
          if (event.retryCount >= MAX_RETRIES) {
            event.status = 'FAILED';
            this.logger.error(`Evento ${event.id} (${event.routingKey}) marcado FAILED tras ${MAX_RETRIES} intentos`);
          }
          await this.outbox.save(event);
        }
      }
    } catch (error) {
      this.logger.error(`Error en el ciclo del outbox: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}

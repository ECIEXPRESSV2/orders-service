import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import type { EventPublisher } from '../../application/ports/event-publisher';
import { OutboxEventEntity } from '../persistence/outbox-event.entity';
import { EVENT_SOURCE } from './event-contracts';

/**
 * Implementación del puerto EventPublisher mediante el patrón Outbox: persiste
 * el evento (con el envelope estándar) en `outbox_events`. Un worker lo publica
 * luego a RabbitMQ, garantizando entrega aunque el broker esté caído.
 */
@Injectable()
export class OutboxService implements EventPublisher {
  constructor(
    @InjectRepository(OutboxEventEntity)
    private readonly outbox: Repository<OutboxEventEntity>,
  ) {}

  async publish(routingKey: string, payload: Record<string, unknown>): Promise<void> {
    const id = randomUUID();
    const enriched = {
      ...payload,
      idempotencyKey: id,
      occurredAt: new Date().toISOString(),
      source: EVENT_SOURCE,
    };
    const event = this.outbox.create({
      id,
      routingKey,
      payload: enriched,
      status: 'PENDING',
      retryCount: 0,
    });
    await this.outbox.save(event);
  }
}

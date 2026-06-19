import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

export type OutboxStatus = 'PENDING' | 'PUBLISHED' | 'FAILED';

/**
 * Patrón Outbox transaccional: cada evento de dominio se guarda en la misma
 * transacción que el cambio de negocio. Un worker lo publica luego a RabbitMQ.
 * Garantiza que no se pierdan eventos si el broker está caído.
 */
@Entity('outbox_events')
export class OutboxEventEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'routing_key', type: 'varchar' })
  routingKey!: string;

  /** Payload plano del evento (incluye idempotencyKey, occurredAt, source). */
  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Index()
  @Column({ type: 'varchar', length: 16, default: 'PENDING' })
  status!: OutboxStatus;

  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount!: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError?: string | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

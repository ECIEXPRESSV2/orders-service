import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Registro de idempotencia para el consumo de eventos entrantes. Antes de
 * aplicar un evento de fulfillment/financial verificamos que su idempotencyKey
 * no haya sido procesada antes.
 */
@Entity('processed_events')
export class ProcessedEventEntity {
  @PrimaryColumn({ name: 'idempotency_key', type: 'varchar' })
  idempotencyKey!: string;

  @Column({ name: 'routing_key', type: 'varchar' })
  routingKey!: string;

  @CreateDateColumn({ name: 'processed_at', type: 'timestamptz' })
  processedAt!: Date;
}

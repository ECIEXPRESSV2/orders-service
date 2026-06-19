import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { OrderActorType, OrderStatus } from '../../domain/order.models';
import { OrderEntity } from './order.entity';

@Entity('order_status_history')
export class OrderStatusHistoryEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @ManyToOne(() => OrderEntity, (order) => order.statusHistory, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order!: OrderEntity;

  @Column({ name: 'from_status', type: 'varchar', length: 32, nullable: true })
  fromStatus!: OrderStatus | null;

  @Column({ name: 'to_status', type: 'varchar', length: 32 })
  toStatus!: OrderStatus;

  @Column({ name: 'actor_type', type: 'varchar', length: 16 })
  actorType!: OrderActorType;

  @Column({ name: 'actor_id', type: 'varchar', nullable: true })
  actorId?: string | null;

  @Column({ type: 'text', nullable: true })
  reason?: string | null;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;
}

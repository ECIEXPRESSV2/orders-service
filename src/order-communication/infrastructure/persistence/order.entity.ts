import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  OrderDeliveryMethod,
  OrderPaymentMethod,
  OrderSource,
  OrderStatus,
} from '../../domain/order.models';
import { bigintCentavosTransformer } from './numeric.transformer';
import { OrderItemEntity } from './order-item.entity';
import { OrderStatusHistoryEntity } from './order-status-history.entity';
import { OrderRatingEntity } from './order-rating.entity';

@Entity('orders')
export class OrderEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'order_number', unique: true })
  orderNumber!: string;

  @Index()
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Index()
  @Column({ name: 'store_id', type: 'uuid' })
  storeId!: string;

  @Column({ name: 'store_name' })
  storeName!: string;

  @Index()
  @Column({ type: 'varchar', length: 32 })
  status!: OrderStatus;

  @Column({ name: 'payment_method', type: 'varchar', length: 16 })
  paymentMethod!: OrderPaymentMethod;

  @Column({ name: 'delivery_method', type: 'varchar', length: 16 })
  deliveryMethod!: OrderDeliveryMethod;

  @Column({ type: 'varchar', length: 8 })
  currency!: string;

  @Column({ type: 'varchar', length: 16 })
  source!: OrderSource;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Index('UQ_orders_idempotency_key', { unique: true })
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, nullable: true })
  idempotencyKey?: string | null;

  @Column({ name: 'scheduled_pickup_at', type: 'timestamptz', nullable: true })
  scheduledPickupAt?: Date | null;

  @Column({ name: 'subtotal_amount', type: 'bigint', transformer: bigintCentavosTransformer })
  subtotalAmount!: number;

  @Column({ name: 'discount_amount', type: 'bigint', transformer: bigintCentavosTransformer })
  discountAmount!: number;

  @Column({ name: 'total_amount', type: 'bigint', transformer: bigintCentavosTransformer })
  totalAmount!: number;

  @OneToMany(() => OrderItemEntity, (item) => item.order, { cascade: true, eager: true })
  items!: OrderItemEntity[];

  @OneToMany(() => OrderStatusHistoryEntity, (history) => history.order, { cascade: true, eager: true })
  statusHistory!: OrderStatusHistoryEntity[];

  @OneToOne(() => OrderRatingEntity, (rating) => rating.order, { cascade: true, eager: true, nullable: true })
  rating?: OrderRatingEntity | null;

  @Column({ name: 'pickup_expires_at', type: 'timestamptz', nullable: true })
  pickupExpiresAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt?: Date | null;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;
}

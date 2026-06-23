import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { bigintCentavosTransformer } from './numeric.transformer';
import { OrderEntity } from './order.entity';

@Entity('order_items')
export class OrderItemEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @ManyToOne(() => OrderEntity, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order!: OrderEntity;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @Column()
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl?: string | null;

  @Column({ name: 'unit_price', type: 'bigint', transformer: bigintCentavosTransformer })
  unitPrice!: number;

  @Column({ type: 'int' })
  quantity!: number;

  @Column({ name: 'total_amount', type: 'bigint', transformer: bigintCentavosTransformer })
  totalAmount!: number;
}

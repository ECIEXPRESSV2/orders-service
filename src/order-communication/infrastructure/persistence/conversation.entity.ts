import { Column, Entity, Index, OneToMany, PrimaryColumn } from 'typeorm';
import type { ConversationStatus } from '../../domain/communication.models';
import { ParticipantEntity } from './participant.entity';

@Entity('conversations')
export class ConversationEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Index()
  @Column({ name: 'store_id', type: 'uuid' })
  storeId!: string;

  @Index()
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Index()
  @Column({ name: 'vendor_id', type: 'uuid' })
  vendorId!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: ConversationStatus;

  @OneToMany(() => ParticipantEntity, (participant) => participant.conversation, { cascade: true, eager: true })
  participants!: ParticipantEntity[];

  @Column({ name: 'last_message_at', type: 'timestamptz', nullable: true })
  lastMessageAt?: Date | null;

  @Column({ name: 'last_message_preview', type: 'text', nullable: true })
  lastMessagePreview?: string | null;

  @Column({ name: 'store_name', type: 'varchar', length: 200, nullable: true })
  storeName?: string | null;

  @Column({ name: 'store_logo_url', type: 'text', nullable: true })
  storeLogoUrl?: string | null;

  @Column({ name: 'customer_name', type: 'varchar', length: 200, nullable: true })
  customerName?: string | null;

  @Column({ name: 'customer_avatar_url', type: 'text', nullable: true })
  customerAvatarUrl?: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;
}

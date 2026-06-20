import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import type {
  MessageReadStatus,
  MessageStatus,
  MessageType,
  ParticipantRole,
} from '../../domain/communication.models';

@Entity('messages')
export class MessageEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @Column({ name: 'sender_id', type: 'uuid' })
  senderId!: string;

  @Column({ name: 'sender_role', type: 'varchar', length: 16 })
  senderRole!: ParticipantRole;

  @Column({ type: 'text' })
  content!: string;

  @Column({ name: 'message_type', type: 'varchar', length: 16 })
  messageType!: MessageType;

  @Column({ type: 'varchar', length: 16 })
  status!: MessageStatus;

  /** Estados de lectura por participante; pocos por mensaje -> JSONB. */
  @Column({ name: 'read_statuses', type: 'jsonb', default: () => "'[]'::jsonb" })
  readStatuses!: MessageReadStatus[];

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;
}

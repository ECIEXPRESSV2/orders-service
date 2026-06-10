import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { MessageStatus, MessageType, ParticipantRole } from '../domain/communication.models';

export class ConversationResponseDto {
  id!: string;
  orderId!: string;
  storeId!: number;
  customerId!: string;
  vendorId!: string;
  status!: 'active' | 'archived' | 'closed';
  participants!: Array<{
    conversationId: string;
    userId: string;
    role: ParticipantRole;
    joinedAt: string;
    leftAt?: string;
    lastReadAt?: string;
    unreadCount: number;
    typing: boolean;
  }>;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  createdAt!: string;
  updatedAt!: string;
}

export class MessageResponseDto {
  id!: string;
  conversationId!: string;
  senderId!: string;
  senderRole!: ParticipantRole;
  content!: string;
  messageType!: MessageType;
  status!: MessageStatus;
  readStatuses!: Array<{
    messageId: string;
    participantId: string;
    readAt: string;
  }>;
  createdAt!: string;
  updatedAt!: string;
}

export class SendMessageDto {
  @ApiProperty({ example: 'conversation-1' })
  conversationId!: string;

  @ApiProperty({ example: 'student-001' })
  senderId!: string;

  @ApiProperty({ enum: ['customer', 'vendor', 'support', 'system'] })
  senderRole!: ParticipantRole;

  @ApiProperty({ example: 'Ya voy en camino' })
  content!: string;
}

export class MarkMessageReadDto {
  @ApiProperty({ example: 'conversation-1' })
  conversationId!: string;

  @ApiProperty({ example: 'message-1' })
  messageId!: string;

  @ApiProperty({ example: 'student-001' })
  participantId!: string;
}

export class TypingDto {
  @ApiProperty({ example: 'conversation-1' })
  conversationId!: string;

  @ApiProperty({ example: 'student-001' })
  userId!: string;

  @ApiProperty({ enum: ['customer', 'vendor', 'support', 'system'] })
  role!: ParticipantRole;

  @ApiProperty({ example: true })
  typing!: boolean;
}

export class ConversationQueryDto {
  @ApiPropertyOptional({ example: 'student-001' })
  customerId?: string;

  @ApiPropertyOptional({ example: 'store-001' })
  vendorId?: string;

  @ApiPropertyOptional({ example: 1 })
  storeId?: number;
}

export class MessageQueryDto {
  @ApiPropertyOptional({ example: 'conversation-1' })
  conversationId?: string;

  @ApiPropertyOptional({ example: 1 })
  page?: number;

  @ApiPropertyOptional({ example: 20 })
  pageSize?: number;
}
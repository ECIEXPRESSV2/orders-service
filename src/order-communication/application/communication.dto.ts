import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { MessageStatus, MessageType, ParticipantRole } from '../domain/communication.models';

export class ConversationResponseDto {
  id!: string;
  orderId!: string;
  storeId!: string;
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
  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  customerId?: string;

  @ApiPropertyOptional({ example: 'c3d4e5f6-a7b8-9012-cdef-123456789012' })
  vendorId?: string;

  @ApiPropertyOptional({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  storeId?: string;
}

export class MessageQueryDto {
  @ApiPropertyOptional({ example: 'conversation-1' })
  conversationId?: string;

  @ApiPropertyOptional({ example: 1 })
  page?: number;

  @ApiPropertyOptional({ example: 20 })
  pageSize?: number;
}
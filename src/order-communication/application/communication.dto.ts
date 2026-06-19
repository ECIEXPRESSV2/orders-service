import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PARTICIPANT_ROLES } from '../domain/communication.models';
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
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  conversationId!: string;

  @ApiPropertyOptional({ description: 'UUID del emisor. Se ignora si hay token: se toma del usuario autenticado.' })
  @IsOptional()
  @IsString()
  senderId?: string;

  @ApiProperty({ enum: PARTICIPANT_ROLES })
  @IsIn(PARTICIPANT_ROLES)
  senderRole!: ParticipantRole;

  @ApiProperty({ example: 'Ya voy en camino' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content!: string;
}

export class MarkMessageReadDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  conversationId!: string;

  @ApiProperty({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  @IsUUID()
  messageId!: string;

  @ApiPropertyOptional({ description: 'UUID del participante. Se ignora si hay token.' })
  @IsOptional()
  @IsString()
  participantId?: string;
}

export class TypingDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  conversationId!: string;

  @ApiPropertyOptional({ description: 'UUID del usuario. Se ignora si hay token.' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiProperty({ enum: PARTICIPANT_ROLES })
  @IsIn(PARTICIPANT_ROLES)
  role!: ParticipantRole;

  @ApiProperty({ example: true })
  @IsBoolean()
  typing!: boolean;
}

export class ConversationQueryDto {
  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({ example: 'c3d4e5f6-a7b8-9012-cdef-123456789012' })
  @IsOptional()
  @IsString()
  vendorId?: string;

  @ApiPropertyOptional({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  @IsOptional()
  @IsString()
  storeId?: string;
}

export class MessageQueryDto {
  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsOptional()
  @IsString()
  conversationId?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

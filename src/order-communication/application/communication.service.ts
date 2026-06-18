import { Injectable, NotFoundException } from '@nestjs/common';
import { RealtimeHubService } from '../../common/realtime-hub.service';
import { InMemoryCommunicationRepository } from '../infrastructure/in-memory-communication.repository';
import { ConversationQueryDto, ConversationResponseDto, MarkMessageReadDto, MessageQueryDto, MessageResponseDto, SendMessageDto, TypingDto } from './communication.dto';
import { createMessage, Conversation } from '../domain/communication.models';

@Injectable()
export class CommunicationService {
  constructor(
    private readonly communicationRepository: InMemoryCommunicationRepository,
    private readonly realtimeHub: RealtimeHubService,
  ) {}

  async getConversations(query: ConversationQueryDto): Promise<ConversationResponseDto[]> {
    const conversations = await this.communicationRepository.listConversations(query);
    return conversations.map((conversation) => this.toConversationResponse(conversation));
  }

  async getConversationById(id: string): Promise<ConversationResponseDto> {
    const conversation = await this.communicationRepository.findConversationById(id);
    if (!conversation) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }

    return this.toConversationResponse(conversation);
  }

  async getMessages(query: MessageQueryDto): Promise<{ items: MessageResponseDto[]; total: number; page: number; pageSize: number }> {
    const result = await this.communicationRepository.listMessages(query);
    return {
      items: result.items.map((message) => this.toMessageResponse(message)),
      total: result.total,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    };
  }

  async sendMessage(dto: SendMessageDto): Promise<MessageResponseDto> {
    const conversation = await this.communicationRepository.findConversationById(dto.conversationId);
    if (!conversation) {
      throw new NotFoundException(`Conversation ${dto.conversationId} not found`);
    }

    const message = createMessage({
      conversationId: dto.conversationId,
      senderId: dto.senderId,
      senderRole: dto.senderRole,
      content: dto.content,
    });

    await this.communicationRepository.saveMessage(message);
    await this.communicationRepository.incrementUnreadCounts(dto.conversationId, dto.senderId);
    await this.communicationRepository.saveConversation({
      ...conversation,
      lastMessageAt: message.createdAt,
      lastMessagePreview: message.content.slice(0, 120),
      updatedAt: message.createdAt,
    });

    const payload = this.toMessageResponse(message);
    this.realtimeHub.publish({
      type: 'message:new',
      room: `conversation:${dto.conversationId}`,
      payload,
      occurredAt: new Date().toISOString(),
    });

    return payload;
  }

  async markMessageAsRead(dto: MarkMessageReadDto): Promise<MessageResponseDto> {
    const message = await this.communicationRepository.markMessageAsRead(dto.messageId, dto.participantId);
    if (!message) {
      throw new NotFoundException(`Message ${dto.messageId} not found`);
    }

    const payload = this.toMessageResponse(message);
    this.realtimeHub.publish({
      type: 'message:read',
      room: `conversation:${dto.conversationId}`,
      payload,
      occurredAt: new Date().toISOString(),
    });

    return payload;
  }

  async setTyping(dto: TypingDto): Promise<void> {
    await this.communicationRepository.setTyping(dto.conversationId, dto.userId, dto.typing);
    this.realtimeHub.publish({
      type: dto.typing ? 'typing:start' : 'typing:stop',
      room: `conversation:${dto.conversationId}`,
      payload: dto,
      occurredAt: new Date().toISOString(),
    });
  }

  async joinConversation(conversationId: string, userId: string, role: 'customer' | 'vendor' | 'support' | 'system'): Promise<ConversationResponseDto> {
    const conversation = await this.communicationRepository.joinConversation(conversationId, userId, role);
    const payload = this.toConversationResponse(conversation);
    this.realtimeHub.publish({
      type: 'conversation:joined',
      room: `conversation:${conversationId}`,
      payload,
      occurredAt: new Date().toISOString(),
    });
    return payload;
  }

  async leaveConversation(conversationId: string, userId: string): Promise<ConversationResponseDto> {
    const conversation = await this.communicationRepository.leaveConversation(conversationId, userId);
    const payload = this.toConversationResponse(conversation);
    this.realtimeHub.publish({
      type: 'conversation:left',
      room: `conversation:${conversationId}`,
      payload,
      occurredAt: new Date().toISOString(),
    });
    return payload;
  }

  async getConversationMessages(conversationId: string): Promise<MessageResponseDto[]> {
    const messages = await this.communicationRepository.getConversationMessages(conversationId);
    return messages.map((message) => this.toMessageResponse(message));
  }

  private toConversationResponse(conversation: Conversation): ConversationResponseDto {
    return {
      id: conversation.id,
      orderId: conversation.orderId,
      storeId: conversation.storeId,
      customerId: conversation.customerId,
      vendorId: conversation.vendorId,
      status: conversation.status,
      participants: conversation.participants,
      lastMessageAt: conversation.lastMessageAt,
      lastMessagePreview: conversation.lastMessagePreview,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  private toMessageResponse(message: import('../domain/communication.models').Message): MessageResponseDto {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderRole: message.senderRole,
      content: message.content,
      messageType: message.messageType,
      status: message.status,
      readStatuses: message.readStatuses,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }
}
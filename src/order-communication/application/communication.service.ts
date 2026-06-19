import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { RealtimeHubService } from '../../common/realtime-hub.service';
import { COMMUNICATION_REPOSITORY } from './ports/communication.repository';
import type { CommunicationRepository } from './ports/communication.repository';
import { EVENT_PUBLISHER } from './ports/event-publisher';
import type { EventPublisher } from './ports/event-publisher';
import { ORDER_EVENTS } from '../infrastructure/messaging/event-contracts';
import { ConversationQueryDto, ConversationResponseDto, MarkMessageReadDto, MessageQueryDto, MessageResponseDto, SendMessageDto, TypingDto } from './communication.dto';
import { createConversation, createMessage, Conversation } from '../domain/communication.models';

@Injectable()
export class CommunicationService {
  constructor(
    @Inject(COMMUNICATION_REPOSITORY) private readonly communicationRepository: CommunicationRepository,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    private readonly realtimeHub: RealtimeHubService,
  ) {}

  /**
   * Crea (o devuelve) la conversación comprador-vendedor de un pedido. Se invoca
   * al crear el pedido para que el chat (RF-09) exista desde el inicio.
   */
  async ensureConversationForOrder(params: {
    orderId: string;
    storeId: string;
    customerId: string;
    vendorId: string;
  }): Promise<ConversationResponseDto> {
    const existing = await this.communicationRepository.findConversationByOrderId(params.orderId);
    if (existing) {
      return this.toConversationResponse(existing);
    }
    const conversation = createConversation(params);
    const saved = await this.communicationRepository.saveConversation(conversation);
    return this.toConversationResponse(saved);
  }

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
    if (!dto.senderId) {
      throw new BadRequestException('senderId is required');
    }
    const senderId = dto.senderId;
    const conversation = await this.communicationRepository.findConversationById(dto.conversationId);
    if (!conversation) {
      throw new NotFoundException(`Conversation ${dto.conversationId} not found`);
    }

    const message = createMessage({
      conversationId: dto.conversationId,
      senderId,
      senderRole: dto.senderRole,
      content: dto.content,
    });

    await this.communicationRepository.saveMessage(message);
    await this.communicationRepository.incrementUnreadCounts(dto.conversationId, senderId);
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

    // Notifica al otro participante (notifications-service consume este evento).
    const recipientId = senderId === conversation.customerId ? conversation.vendorId : conversation.customerId;
    await this.events.publish(ORDER_EVENTS.CHAT_MESSAGE_SENT, {
      messageId: message.id,
      conversationId: message.conversationId,
      senderId,
      recipientId,
      preview: message.content.slice(0, 120),
    });

    return payload;
  }

  async markMessageAsRead(dto: MarkMessageReadDto): Promise<MessageResponseDto> {
    if (!dto.participantId) {
      throw new BadRequestException('participantId is required');
    }
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
    if (!dto.userId) {
      throw new BadRequestException('userId is required');
    }
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
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { RealtimeHubService } from '../../common/realtime-hub.service';
import { COMMUNICATION_REPOSITORY } from './ports/communication.repository';
import type { CommunicationRepository } from './ports/communication.repository';
import { EVENT_PUBLISHER } from './ports/event-publisher';
import type { EventPublisher } from './ports/event-publisher';
import { IDENTITY_PORT } from './ports/identity.port';
import type { IdentityPort } from './ports/identity.port';
import { ORDER_EVENTS } from '../infrastructure/messaging/event-contracts';
import { ConversationQueryDto, ConversationResponseDto, MarkMessageReadDto, MessageQueryDto, MessageResponseDto, SendMessageDto, TypingDto } from './communication.dto';
import { createConversation, createMessage, Conversation, RefundMessageKind, RefundMessagePayload, SYSTEM_SENDER_ID } from '../domain/communication.models';

@Injectable()
export class CommunicationService {
  constructor(
    @Inject(COMMUNICATION_REPOSITORY) private readonly communicationRepository: CommunicationRepository,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(IDENTITY_PORT) private readonly identity: IdentityPort,
    private readonly realtimeHub: RealtimeHubService,
  ) {}

  /**
   * Crea (o devuelve) la conversación comprador-vendedor de un pedido. Se invoca cuando
   * el pedido pasa a CONFIRMED (no antes: mientras la tienda no lo confirma, el chat no
   * existe todavía para ninguno de los dos lados). Enriquece la conversación con la
   * identidad visual de cada lado (nombre/logo de tienda, nombre/foto del cliente),
   * resuelta best-effort contra identity-service: si falla, el campo queda vacío y el
   * frontend cae a las iniciales.
   */
  async ensureConversationForOrder(params: {
    orderId: string;
    storeId: string;
    customerId: string;
    vendorId: string;
    storeName?: string;
  }): Promise<ConversationResponseDto> {
    const existing = await this.communicationRepository.findConversationByOrderId(params.orderId);
    if (existing) {
      return this.toConversationResponse(existing);
    }
    const [storeDisplay, customerDisplay] = await Promise.all([
      this.identity.getStoreDisplay(params.storeId),
      this.identity.getUserDisplay(params.customerId),
    ]);
    const conversation = createConversation({
      ...params,
      storeName: params.storeName ?? storeDisplay?.name,
      storeLogoUrl: storeDisplay?.logoUrl ?? undefined,
      customerName: customerDisplay?.fullName,
      customerAvatarUrl: customerDisplay?.avatarUrl ?? undefined,
    });
    const saved = await this.communicationRepository.saveConversation(conversation);
    return this.toConversationResponse(saved);
  }

  /**
   * Cierra el chat de un pedido de forma permanente (entregado o cancelado): ninguno de
   * los 2 lados vuelve a verlo ni a escribir en él. No-op si el pedido no llegó a tener
   * conversación (nunca se confirmó).
   */
  async closeConversationForOrder(orderId: string): Promise<void> {
    const existing = await this.communicationRepository.findConversationByOrderId(orderId);
    if (!existing || existing.status === 'closed') return;
    const conversation = await this.communicationRepository.setConversationStatus(existing.id, 'closed');
    this.publishToParticipants(conversation, 'conversation:updated', this.toConversationResponse(conversation));
  }

  /**
   * Verifica que `userId` sea parte de la conversación: el cliente del pedido, o staff
   * activo de la tienda (cualquier miembro, no solo el `vendorId` fijado al crearla).
   * Lanza `ForbiddenException` si no aplica ninguno de los dos casos.
   */
  private async assertParticipant(conversation: Conversation, userId: string): Promise<void> {
    if (userId === conversation.customerId) return;
    if (await this.identity.isStoreStaff(conversation.storeId, userId)) return;
    throw new ForbiddenException('No tienes acceso a esta conversación');
  }

  /**
   * Lista las conversaciones de `userId`. Si pide por `storeId`, debe ser staff activo de
   * esa tienda (si no, 403); cualquier `customerId` recibido se ignora y se fuerza al
   * propio `userId` (un cliente solo puede pedir sus propios chats). `vendorId` ya no es
   * un filtro público: el control de acceso es por pertenencia a la tienda, no por el
   * `vendorId` fijo asignado al crear la conversación.
   */
  async getConversations(query: ConversationQueryDto, userId: string): Promise<ConversationResponseDto[]> {
    const filters: { orderId?: string; customerId?: string; storeId?: string; status?: ConversationQueryDto['status'] } = {
      orderId: query.orderId,
      status: query.status,
    };
    if (query.storeId) {
      if (!(await this.identity.isStoreStaff(query.storeId, userId))) {
        throw new ForbiddenException('No eres staff de esta tienda');
      }
      filters.storeId = query.storeId;
    } else {
      filters.customerId = userId;
    }
    const conversations = await this.communicationRepository.listConversations(filters);
    return conversations.map((conversation) => this.toConversationResponse(conversation));
  }

  async getConversationById(id: string, userId: string): Promise<ConversationResponseDto> {
    const conversation = await this.communicationRepository.findConversationById(id);
    if (!conversation) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }
    await this.assertParticipant(conversation, userId);

    return this.toConversationResponse(conversation);
  }

  async getMessages(query: MessageQueryDto, userId: string): Promise<{ items: MessageResponseDto[]; total: number; page: number; pageSize: number }> {
    if (!query.conversationId) {
      throw new BadRequestException('conversationId is required');
    }
    const conversation = await this.communicationRepository.findConversationById(query.conversationId);
    if (!conversation) {
      throw new NotFoundException(`Conversation ${query.conversationId} not found`);
    }
    await this.assertParticipant(conversation, userId);
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
    await this.assertParticipant(conversation, senderId);

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

    // Actualiza la lista de chats en vivo (preview, hora, no leídos, reordenamiento)
    // para todos los participantes, estén o no con la conversación abierta.
    const updated = await this.communicationRepository.findConversationById(dto.conversationId);
    if (updated) {
      this.publishToParticipants(updated, 'conversation:updated', this.toConversationResponse(updated));
    }

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

  /**
   * Publica en el chat del pedido una tarjeta de reembolso (solicitado/aprobado/rechazado).
   * `content` va como JSON de `RefundMessagePayload`; el frontend la interpreta según
   * `messageType: 'refund'` para pintar la imagen + estado + acciones del vendedor.
   * No-op si el pedido nunca llegó a tener conversación (no se confirmó): no hay dónde avisar.
   */
  async postRefundMessage(orderId: string, payload: RefundMessagePayload): Promise<MessageResponseDto | null> {
    const conversation = await this.communicationRepository.findConversationByOrderId(orderId);
    if (!conversation) return null;

    const message = createMessage({
      conversationId: conversation.id,
      senderId: SYSTEM_SENDER_ID,
      senderRole: 'system',
      content: JSON.stringify(payload),
      messageType: 'refund',
    });

    await this.communicationRepository.saveMessage(message);
    await this.communicationRepository.incrementUnreadCounts(conversation.id, SYSTEM_SENDER_ID);
    const preview =
      payload.kind === 'requested' ? '💸 Reembolso solicitado' : payload.kind === 'approved' ? '💸 Reembolso aprobado' : '💸 Reembolso rechazado';
    await this.communicationRepository.saveConversation({
      ...conversation,
      lastMessageAt: message.createdAt,
      lastMessagePreview: preview,
      updatedAt: message.createdAt,
    });

    const responsePayload = this.toMessageResponse(message);
    this.realtimeHub.publish({
      type: 'message:new',
      room: `conversation:${conversation.id}`,
      payload: responsePayload,
      occurredAt: new Date().toISOString(),
    });

    const updated = await this.communicationRepository.findConversationById(conversation.id);
    if (updated) {
      this.publishToParticipants(updated, 'conversation:updated', this.toConversationResponse(updated));
    }

    return responsePayload;
  }

  /**
   * Resuelve (aprueba/rechaza) el reembolso pendiente del pedido: actualiza EN EL MISMO mensaje
   * la tarjeta que se creó con `postRefundMessage` (cambia `kind`, agrega `reason` si rechaza),
   * en vez de publicar un mensaje nuevo — así el chat muestra una sola tarjeta cuyo estado
   * evoluciona, no una serie de tarjetas repetidas. No-op si no hay conversación o no hay
   * ninguna tarjeta de reembolso en ella (no debería pasar: se llama justo tras aprobar/rechazar).
   */
  async resolveRefundMessage(
    orderId: string,
    patch: { kind: Extract<RefundMessageKind, 'approved' | 'rejected'>; reason?: string },
  ): Promise<MessageResponseDto | null> {
    const conversation = await this.communicationRepository.findConversationByOrderId(orderId);
    if (!conversation) return null;

    const messages = await this.communicationRepository.getConversationMessages(conversation.id);
    const target = [...messages].reverse().find((m) => m.messageType === 'refund');
    if (!target) return null;

    const payload = JSON.parse(target.content) as RefundMessagePayload;
    const nextPayload: RefundMessagePayload = { ...payload, kind: patch.kind, reason: patch.reason ?? payload.reason };
    const updatedMessage = { ...target, content: JSON.stringify(nextPayload), updatedAt: new Date().toISOString() };

    await this.communicationRepository.saveMessage(updatedMessage);
    const responsePayload = this.toMessageResponse(updatedMessage);
    this.realtimeHub.publish({
      type: 'message:updated',
      room: `conversation:${conversation.id}`,
      payload: responsePayload,
      occurredAt: new Date().toISOString(),
    });

    const preview = patch.kind === 'approved' ? '💸 Reembolso aprobado' : '💸 Reembolso rechazado';
    await this.communicationRepository.saveConversation({
      ...conversation,
      lastMessageAt: updatedMessage.updatedAt,
      lastMessagePreview: preview,
      updatedAt: updatedMessage.updatedAt,
    });
    const updatedConversation = await this.communicationRepository.findConversationById(conversation.id);
    if (updatedConversation) {
      this.publishToParticipants(updatedConversation, 'conversation:updated', this.toConversationResponse(updatedConversation));
    }

    return responsePayload;
  }

  async markMessageAsRead(dto: MarkMessageReadDto): Promise<MessageResponseDto> {
    if (!dto.participantId) {
      throw new BadRequestException('participantId is required');
    }
    const conversation = await this.communicationRepository.findConversationById(dto.conversationId);
    if (!conversation) {
      throw new NotFoundException(`Conversation ${dto.conversationId} not found`);
    }
    await this.assertParticipant(conversation, dto.participantId);
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

  /**
   * Marca toda la conversación como leída para un usuario: resetea su contador de
   * no leídos y emite `conversation:read` para que el emisor vea el doble check (leído),
   * más `conversation:updated` al propio lector para limpiar su badge en la lista.
   */
  async markConversationRead(conversationId: string, userId: string): Promise<ConversationResponseDto> {
    const existing = await this.communicationRepository.findConversationById(conversationId);
    if (!existing) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }
    await this.assertParticipant(existing, userId);
    const { conversation, messageIds } = await this.communicationRepository.markConversationRead(conversationId, userId);
    const now = new Date().toISOString();
    if (messageIds.length > 0) {
      this.realtimeHub.publish({
        type: 'conversation:read',
        room: `conversation:${conversationId}`,
        payload: { conversationId, readerId: userId, messageIds, readAt: now },
        occurredAt: now,
      });
    }
    const payload = this.toConversationResponse(conversation);
    this.realtimeHub.publish({
      type: 'conversation:updated',
      room: `user:${userId}`,
      payload,
      occurredAt: now,
    });
    return payload;
  }

  /**
   * Archiva o reactiva una conversación (toggle personal del usuario) y lo refleja en la
   * lista de cada participante. Solo `active`/`archived`: cerrar un chat es una decisión
   * del sistema (`closeConversationForOrder`), no una acción de usuario.
   */
  async setConversationStatus(conversationId: string, status: 'active' | 'archived', userId: string): Promise<ConversationResponseDto> {
    const existing = await this.communicationRepository.findConversationById(conversationId);
    if (!existing) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }
    await this.assertParticipant(existing, userId);
    const conversation = await this.communicationRepository.setConversationStatus(conversationId, status);
    const payload = this.toConversationResponse(conversation);
    this.publishToParticipants(conversation, 'conversation:updated', payload);
    return payload;
  }

  async setTyping(dto: TypingDto): Promise<void> {
    if (!dto.userId) {
      throw new BadRequestException('userId is required');
    }
    const conversation = await this.communicationRepository.findConversationById(dto.conversationId);
    if (!conversation) {
      throw new NotFoundException(`Conversation ${dto.conversationId} not found`);
    }
    await this.assertParticipant(conversation, dto.userId);
    await this.communicationRepository.setTyping(dto.conversationId, dto.userId, dto.typing);
    this.realtimeHub.publish({
      type: dto.typing ? 'typing:start' : 'typing:stop',
      room: `conversation:${dto.conversationId}`,
      payload: dto,
      occurredAt: new Date().toISOString(),
    });
  }

  async joinConversation(conversationId: string, userId: string, role: 'customer' | 'vendor' | 'support' | 'system'): Promise<ConversationResponseDto> {
    const existing = await this.communicationRepository.findConversationById(conversationId);
    if (!existing) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }
    await this.assertParticipant(existing, userId);
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

  async getConversationMessages(conversationId: string, userId: string): Promise<MessageResponseDto[]> {
    const conversation = await this.communicationRepository.findConversationById(conversationId);
    if (!conversation) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }
    await this.assertParticipant(conversation, userId);
    const messages = await this.communicationRepository.getConversationMessages(conversationId);
    return messages.map((message) => this.toMessageResponse(message));
  }

  /** Emite un evento a la "sala personal" (`user:<id>`) de cada participante del chat. */
  private publishToParticipants(conversation: Conversation, type: string, payload: unknown): void {
    const userIds = new Set<string>([
      conversation.customerId,
      conversation.vendorId,
      ...conversation.participants.map((participant) => participant.userId),
    ]);
    const occurredAt = new Date().toISOString();
    for (const userId of userIds) {
      if (!userId) continue;
      this.realtimeHub.publish({ type, room: `user:${userId}`, payload, occurredAt });
    }
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
      storeName: conversation.storeName,
      storeLogoUrl: conversation.storeLogoUrl,
      customerName: conversation.customerName,
      customerAvatarUrl: conversation.customerAvatarUrl,
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
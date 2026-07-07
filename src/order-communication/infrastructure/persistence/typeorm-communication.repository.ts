import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import type {
  Conversation,
  ConversationStatus,
  Message,
  Participant,
  ParticipantRole,
} from '../../domain/communication.models';
import type { CommunicationRepository } from '../../application/ports/communication.repository';
import { ConversationEntity } from './conversation.entity';
import { ParticipantEntity } from './participant.entity';
import { MessageEntity } from './message.entity';

const iso = (date?: Date | null): string | undefined => (date ? date.toISOString() : undefined);

@Injectable()
export class TypeOrmCommunicationRepository implements CommunicationRepository {
  constructor(
    @InjectRepository(ConversationEntity)
    private readonly conversations: Repository<ConversationEntity>,
    @InjectRepository(MessageEntity)
    private readonly messages: Repository<MessageEntity>,
  ) {}

  /**
   * Excluye siempre las conversaciones cerradas: un chat cerrado (pedido entregado o
   * cancelado) no vuelve a ser visible para ningún lado por esta vía. La única forma de
   * tocar un chat cerrado es `findConversationByOrderId` (uso interno de ciclo de vida:
   * idempotencia de `ensureConversationForOrder` y de `closeConversationForOrder`).
   */
  async findConversationById(id: string): Promise<Conversation | null> {
    const entity = await this.conversations.findOne({ where: { id, status: Not('closed') } });
    return entity ? this.toConversation(entity) : null;
  }

  async findConversationByOrderId(orderId: string): Promise<Conversation | null> {
    const entity = await this.conversations.findOne({ where: { orderId } });
    return entity ? this.toConversation(entity) : null;
  }

  async listConversations(filters?: { orderId?: string; customerId?: string; vendorId?: string; storeId?: string; status?: ConversationStatus }): Promise<Conversation[]> {
    const where: Record<string, unknown> = {};
    if (filters?.orderId) where.orderId = filters.orderId;
    if (filters?.customerId) where.customerId = filters.customerId;
    if (filters?.vendorId) where.vendorId = filters.vendorId;
    if (filters?.storeId) where.storeId = filters.storeId;
    // 'closed' nunca es un filtro válido aquí: un chat cerrado no vuelve a listarse por
    // ninguna vía normal, sin importar lo que pida el llamador.
    where.status = filters?.status && filters.status !== 'closed' ? filters.status : Not('closed');
    const entities = await this.conversations.find({ where, order: { updatedAt: 'DESC' } });
    return entities.map((entity) => this.toConversation(entity));
  }

  async saveConversation(conversation: Conversation): Promise<Conversation> {
    const existing = await this.conversations.findOne({ where: { id: conversation.id } });
    if (existing) {
      // Actualización: solo campos escalares. Los participantes se gestionan en
      // join/leave/typing/unread para no re-insertarlos (viola el índice único).
      existing.status = conversation.status;
      existing.lastMessageAt = conversation.lastMessageAt ? new Date(conversation.lastMessageAt) : null;
      existing.lastMessagePreview = conversation.lastMessagePreview ?? null;
      existing.storeName = conversation.storeName ?? existing.storeName;
      existing.storeLogoUrl = conversation.storeLogoUrl ?? existing.storeLogoUrl;
      existing.customerName = conversation.customerName ?? existing.customerName;
      existing.customerAvatarUrl = conversation.customerAvatarUrl ?? existing.customerAvatarUrl;
      existing.updatedAt = new Date(conversation.updatedAt);
      existing.deletedAt = conversation.deletedAt ? new Date(conversation.deletedAt) : null;
      await this.conversations.save(existing);
      return this.toConversation(existing);
    }
    // Creación: inserta la conversación con sus participantes iniciales.
    const entity = this.toConversationEntity(conversation);
    await this.conversations.save(entity);
    const reloaded = await this.conversations.findOne({ where: { id: conversation.id } });
    return this.toConversation(reloaded ?? entity);
  }

  async getConversationMessages(conversationId: string): Promise<Message[]> {
    const entities = await this.messages.find({ where: { conversationId }, order: { createdAt: 'ASC' } });
    return entities.map((entity) => this.toMessage(entity));
  }

  async listMessages(query?: { conversationId?: string; page?: number; pageSize?: number }): Promise<{ items: Message[]; total: number }> {
    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? 20;
    const where = query?.conversationId ? { conversationId: query.conversationId } : {};
    const [entities, total] = await this.messages.findAndCount({
      where,
      order: { createdAt: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items: entities.map((entity) => this.toMessage(entity)), total };
  }

  async saveMessage(message: Message): Promise<Message> {
    const entity = this.toMessageEntity(message);
    await this.messages.save(entity);
    return this.toMessage(entity);
  }

  async markMessageAsRead(messageId: string, participantId: string): Promise<Message | null> {
    const entity = await this.messages.findOne({ where: { id: messageId } });
    if (!entity) return null;

    const readAt = new Date().toISOString();
    if (!entity.readStatuses.some((status) => status.participantId === participantId)) {
      entity.readStatuses = [...entity.readStatuses, { messageId, participantId, readAt }];
    }
    entity.status = 'read';
    entity.updatedAt = new Date(readAt);
    await this.messages.save(entity);
    return this.toMessage(entity);
  }

  async markConversationRead(conversationId: string, userId: string): Promise<{ conversation: Conversation; messageIds: string[] }> {
    const entity = await this.conversations.findOne({ where: { id: conversationId } });
    if (!entity) throw new Error(`Conversation ${conversationId} not found`);

    const now = new Date();
    // Resetea el contador de no leídos del participante y registra la última lectura.
    entity.participants = entity.participants.map((participant) =>
      participant.userId === userId ? { ...participant, unreadCount: 0, lastReadAt: now } : participant,
    );
    entity.updatedAt = now;
    await this.conversations.save(entity);

    // Marca como leídos los mensajes entrantes (de otros) que aún no haya leído este usuario.
    const messages = await this.messages.find({ where: { conversationId } });
    const updated: MessageEntity[] = [];
    for (const message of messages) {
      if (message.senderId === userId) continue;
      if ((message.readStatuses ?? []).some((status) => status.participantId === userId)) continue;
      message.readStatuses = [...(message.readStatuses ?? []), { messageId: message.id, participantId: userId, readAt: now.toISOString() }];
      message.status = 'read';
      message.updatedAt = now;
      updated.push(message);
    }
    if (updated.length > 0) await this.messages.save(updated);

    return { conversation: this.toConversation(entity), messageIds: updated.map((m) => m.id) };
  }

  async setConversationStatus(conversationId: string, status: ConversationStatus): Promise<Conversation> {
    const entity = await this.conversations.findOne({ where: { id: conversationId } });
    if (!entity) throw new Error(`Conversation ${conversationId} not found`);
    entity.status = status;
    entity.updatedAt = new Date();
    await this.conversations.save(entity);
    return this.toConversation(entity);
  }

  async setTyping(conversationId: string, userId: string, typing: boolean): Promise<void> {
    const entity = await this.conversations.findOne({ where: { id: conversationId } });
    if (!entity) return;
    entity.participants = entity.participants.map((participant) =>
      participant.userId === userId ? { ...participant, typing } : participant,
    );
    entity.updatedAt = new Date();
    await this.conversations.save(entity);
  }

  async incrementUnreadCounts(conversationId: string, senderId: string): Promise<void> {
    const entity = await this.conversations.findOne({ where: { id: conversationId } });
    if (!entity) return;
    entity.participants = entity.participants.map((participant) =>
      participant.userId === senderId ? participant : { ...participant, unreadCount: participant.unreadCount + 1 },
    );
    entity.updatedAt = new Date();
    await this.conversations.save(entity);
  }

  async joinConversation(conversationId: string, userId: string, role: ParticipantRole): Promise<Conversation> {
    const entity = await this.conversations.findOne({ where: { id: conversationId } });
    if (!entity) throw new Error(`Conversation ${conversationId} not found`);

    if (!entity.participants.some((participant) => participant.userId === userId)) {
      const participant = new ParticipantEntity();
      participant.conversationId = conversationId;
      participant.userId = userId;
      participant.role = role;
      participant.joinedAt = new Date();
      participant.unreadCount = 0;
      participant.typing = false;
      entity.participants = [...entity.participants, participant];
    }
    entity.updatedAt = new Date();
    await this.conversations.save(entity);
    return this.toConversation(entity);
  }

  async leaveConversation(conversationId: string, userId: string): Promise<Conversation> {
    const entity = await this.conversations.findOne({ where: { id: conversationId } });
    if (!entity) throw new Error(`Conversation ${conversationId} not found`);
    const leftAt = new Date();
    entity.participants = entity.participants.map((participant) =>
      participant.userId === userId ? { ...participant, leftAt, typing: false } : participant,
    );
    entity.updatedAt = leftAt;
    await this.conversations.save(entity);
    return this.toConversation(entity);
  }

  // ─── mappers ────────────────────────────────────────────────
  private toConversationEntity(conversation: Conversation): ConversationEntity {
    const entity = new ConversationEntity();
    entity.id = conversation.id;
    entity.orderId = conversation.orderId;
    entity.storeId = conversation.storeId;
    entity.customerId = conversation.customerId;
    entity.vendorId = conversation.vendorId;
    entity.status = conversation.status;
    entity.lastMessageAt = conversation.lastMessageAt ? new Date(conversation.lastMessageAt) : null;
    entity.lastMessagePreview = conversation.lastMessagePreview ?? null;
    entity.storeName = conversation.storeName ?? null;
    entity.storeLogoUrl = conversation.storeLogoUrl ?? null;
    entity.customerName = conversation.customerName ?? null;
    entity.customerAvatarUrl = conversation.customerAvatarUrl ?? null;
    entity.createdAt = new Date(conversation.createdAt);
    entity.updatedAt = new Date(conversation.updatedAt);
    entity.deletedAt = conversation.deletedAt ? new Date(conversation.deletedAt) : null;
    entity.participants = conversation.participants.map((participant) => this.toParticipantEntity(participant));
    return entity;
  }

  private toParticipantEntity(participant: Participant): ParticipantEntity {
    const entity = new ParticipantEntity();
    entity.conversationId = participant.conversationId;
    entity.userId = participant.userId;
    entity.role = participant.role;
    entity.joinedAt = new Date(participant.joinedAt);
    entity.leftAt = participant.leftAt ? new Date(participant.leftAt) : null;
    entity.lastReadAt = participant.lastReadAt ? new Date(participant.lastReadAt) : null;
    entity.unreadCount = participant.unreadCount;
    entity.typing = participant.typing;
    return entity;
  }

  private toConversation(entity: ConversationEntity): Conversation {
    return {
      id: entity.id,
      orderId: entity.orderId,
      storeId: entity.storeId,
      customerId: entity.customerId,
      vendorId: entity.vendorId,
      status: entity.status,
      participants: (entity.participants ?? []).map((participant) => ({
        conversationId: participant.conversationId,
        userId: participant.userId,
        role: participant.role,
        joinedAt: participant.joinedAt.toISOString(),
        leftAt: iso(participant.leftAt),
        lastReadAt: iso(participant.lastReadAt),
        unreadCount: participant.unreadCount,
        typing: participant.typing,
      })),
      lastMessageAt: iso(entity.lastMessageAt),
      lastMessagePreview: entity.lastMessagePreview ?? undefined,
      storeName: entity.storeName ?? undefined,
      storeLogoUrl: entity.storeLogoUrl ?? undefined,
      customerName: entity.customerName ?? undefined,
      customerAvatarUrl: entity.customerAvatarUrl ?? undefined,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
      deletedAt: iso(entity.deletedAt),
    };
  }

  private toMessageEntity(message: Message): MessageEntity {
    const entity = new MessageEntity();
    entity.id = message.id;
    entity.conversationId = message.conversationId;
    entity.senderId = message.senderId;
    entity.senderRole = message.senderRole;
    entity.content = message.content;
    entity.messageType = message.messageType;
    entity.status = message.status;
    entity.readStatuses = message.readStatuses;
    entity.createdAt = new Date(message.createdAt);
    entity.updatedAt = new Date(message.updatedAt);
    entity.deletedAt = message.deletedAt ? new Date(message.deletedAt) : null;
    return entity;
  }

  private toMessage(entity: MessageEntity): Message {
    return {
      id: entity.id,
      conversationId: entity.conversationId,
      senderId: entity.senderId,
      senderRole: entity.senderRole,
      content: entity.content,
      messageType: entity.messageType,
      status: entity.status,
      readStatuses: entity.readStatuses ?? [],
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
      deletedAt: iso(entity.deletedAt),
    };
  }
}

import { Injectable } from '@nestjs/common';
import { Conversation, Message, createConversation, createMessage } from '../domain/communication.models';

@Injectable()
export class InMemoryCommunicationRepository {
  private readonly conversations = new Map<string, Conversation>();
  private readonly messages = new Map<string, Message>();

  constructor() {
    this.seed();
  }

  async findConversationById(id: string): Promise<Conversation | null> {
    const conversation = this.conversations.get(id);
    return conversation ? structuredClone(conversation) : null;
  }

  async findConversationByOrderId(orderId: string): Promise<Conversation | null> {
    const conversation = [...this.conversations.values()].find((entry) => entry.orderId === orderId);
    return conversation ? structuredClone(conversation) : null;
  }

  async listConversations(filters?: { customerId?: string; vendorId?: string; storeId?: number }): Promise<Conversation[]> {
    return [...this.conversations.values()]
      .filter((conversation) => !filters?.customerId || conversation.customerId === filters.customerId)
      .filter((conversation) => !filters?.vendorId || conversation.vendorId === filters.vendorId)
      .filter((conversation) => filters?.storeId === undefined || conversation.storeId === filters.storeId)
      .sort((left, right) => (right.lastMessageAt ?? right.createdAt).localeCompare(left.lastMessageAt ?? left.createdAt))
      .map((conversation) => structuredClone(conversation));
  }

  async saveConversation(conversation: Conversation): Promise<Conversation> {
    this.conversations.set(conversation.id, structuredClone(conversation));
    return structuredClone(conversation);
  }

  async getConversationMessages(conversationId: string): Promise<Message[]> {
    return [...this.messages.values()]
      .filter((message) => message.conversationId === conversationId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((message) => structuredClone(message));
  }

  async listMessages(query?: { conversationId?: string; page?: number; pageSize?: number }): Promise<{ items: Message[]; total: number }> {
    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? 20;
    const items = [...this.messages.values()]
      .filter((message) => !query?.conversationId || message.conversationId === query.conversationId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    const startIndex = (page - 1) * pageSize;
    return {
      total: items.length,
      items: items.slice(startIndex, startIndex + pageSize).map((message) => structuredClone(message)),
    };
  }

  async saveMessage(message: Message): Promise<Message> {
    this.messages.set(message.id, structuredClone(message));
    return structuredClone(message);
  }

  async markMessageAsRead(messageId: string, participantId: string): Promise<Message | null> {
    const message = this.messages.get(messageId);
    if (!message) {
      return null;
    }

    const readAt = new Date().toISOString();
    if (!message.readStatuses.some((entry) => entry.participantId === participantId)) {
      message.readStatuses = [...message.readStatuses, { messageId, participantId, readAt }];
    }
    message.status = 'read';
    message.updatedAt = readAt;
    this.messages.set(messageId, message);
    return structuredClone(message);
  }

  async setTyping(conversationId: string, userId: string, typing: boolean): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return;
    }

    conversation.participants = conversation.participants.map((participant) => (
      participant.userId === userId ? { ...participant, typing } : participant
    ));
    conversation.updatedAt = new Date().toISOString();
    this.conversations.set(conversationId, conversation);
  }

  async incrementUnreadCounts(conversationId: string, senderId: string): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return;
    }

    conversation.participants = conversation.participants.map((participant) => (
      participant.userId === senderId ? participant : { ...participant, unreadCount: participant.unreadCount + 1 }
    ));
    conversation.updatedAt = new Date().toISOString();
    this.conversations.set(conversationId, conversation);
  }

  async joinConversation(conversationId: string, userId: string, role: 'customer' | 'vendor' | 'support' | 'system'): Promise<Conversation> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    if (!conversation.participants.some((participant) => participant.userId === userId)) {
      conversation.participants = [
        ...conversation.participants,
        { conversationId, userId, role, joinedAt: new Date().toISOString(), unreadCount: 0, typing: false },
      ];
    }

    conversation.updatedAt = new Date().toISOString();
    this.conversations.set(conversationId, conversation);
    return structuredClone(conversation);
  }

  async leaveConversation(conversationId: string, userId: string): Promise<Conversation> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    conversation.participants = conversation.participants.map((participant) => (
      participant.userId === userId
        ? { ...participant, leftAt: new Date().toISOString(), typing: false }
        : participant
    ));
    conversation.updatedAt = new Date().toISOString();
    this.conversations.set(conversationId, conversation);
    return structuredClone(conversation);
  }

  private seed(): void {
    const conversation = createConversation({
      orderId: 'seed-order-001',
      storeId: 1,
      customerId: 'student-001',
      vendorId: 'store-001',
    });
    conversation.id = 'conv-0001';
    conversation.lastMessageAt = new Date(Date.now() - 1000 * 60 * 10).toISOString();
    conversation.lastMessagePreview = 'Tu pedido está casi listo.';
    conversation.createdAt = new Date(Date.now() - 1000 * 60 * 60).toISOString();
    conversation.updatedAt = conversation.lastMessageAt;
    conversation.participants = [
      { conversationId: conversation.id, userId: 'student-001', role: 'customer', joinedAt: conversation.createdAt, unreadCount: 0, typing: false },
      { conversationId: conversation.id, userId: 'store-001', role: 'vendor', joinedAt: conversation.createdAt, unreadCount: 0, typing: false },
    ];
    this.conversations.set(conversation.id, conversation);

    const message = createMessage({
      conversationId: conversation.id,
      senderId: 'store-001',
      senderRole: 'vendor',
      content: 'Tu pedido está casi listo.',
      messageType: 'system',
    });
    message.createdAt = conversation.lastMessageAt;
    message.updatedAt = conversation.lastMessageAt;
    this.messages.set(message.id, message);
  }
}
import type { Conversation, Message, ParticipantRole } from '../../domain/communication.models';

/**
 * Puerto de persistencia de conversaciones y mensajes.
 */
export interface CommunicationRepository {
  findConversationById(id: string): Promise<Conversation | null>;
  findConversationByOrderId(orderId: string): Promise<Conversation | null>;
  listConversations(filters?: { customerId?: string; vendorId?: string; storeId?: string }): Promise<Conversation[]>;
  saveConversation(conversation: Conversation): Promise<Conversation>;
  getConversationMessages(conversationId: string): Promise<Message[]>;
  listMessages(query?: { conversationId?: string; page?: number; pageSize?: number }): Promise<{ items: Message[]; total: number }>;
  saveMessage(message: Message): Promise<Message>;
  markMessageAsRead(messageId: string, participantId: string): Promise<Message | null>;
  setTyping(conversationId: string, userId: string, typing: boolean): Promise<void>;
  incrementUnreadCounts(conversationId: string, senderId: string): Promise<void>;
  joinConversation(conversationId: string, userId: string, role: ParticipantRole): Promise<Conversation>;
  leaveConversation(conversationId: string, userId: string): Promise<Conversation>;
}

export const COMMUNICATION_REPOSITORY = Symbol('COMMUNICATION_REPOSITORY');

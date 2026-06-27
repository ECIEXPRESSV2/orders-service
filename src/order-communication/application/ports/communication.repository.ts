import type { Conversation, ConversationStatus, Message, ParticipantRole } from '../../domain/communication.models';

/**
 * Puerto de persistencia de conversaciones y mensajes.
 */
export interface CommunicationRepository {
  findConversationById(id: string): Promise<Conversation | null>;
  findConversationByOrderId(orderId: string): Promise<Conversation | null>;
  listConversations(filters?: { orderId?: string; customerId?: string; vendorId?: string; storeId?: string; status?: ConversationStatus }): Promise<Conversation[]>;
  saveConversation(conversation: Conversation): Promise<Conversation>;
  getConversationMessages(conversationId: string): Promise<Message[]>;
  listMessages(query?: { conversationId?: string; page?: number; pageSize?: number }): Promise<{ items: Message[]; total: number }>;
  saveMessage(message: Message): Promise<Message>;
  markMessageAsRead(messageId: string, participantId: string): Promise<Message | null>;
  /** Marca como leídos todos los mensajes entrantes no leídos y resetea el contador del participante. */
  markConversationRead(conversationId: string, userId: string): Promise<{ conversation: Conversation; messageIds: string[] }>;
  /** Cambia el estado de la conversación (active / archived / closed). */
  setConversationStatus(conversationId: string, status: ConversationStatus): Promise<Conversation>;
  setTyping(conversationId: string, userId: string, typing: boolean): Promise<void>;
  incrementUnreadCounts(conversationId: string, senderId: string): Promise<void>;
  joinConversation(conversationId: string, userId: string, role: ParticipantRole): Promise<Conversation>;
  leaveConversation(conversationId: string, userId: string): Promise<Conversation>;
}

export const COMMUNICATION_REPOSITORY = Symbol('COMMUNICATION_REPOSITORY');

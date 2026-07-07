export type ConversationStatus = 'active' | 'archived' | 'closed';
export type ParticipantRole = 'customer' | 'vendor' | 'support' | 'system';
export type MessageStatus = 'sent' | 'delivered' | 'read' | 'deleted';
export type MessageType = 'text' | 'system' | 'status-update';

export const PARTICIPANT_ROLES: ParticipantRole[] = ['customer', 'vendor', 'support', 'system'];

export interface Participant {
  conversationId: string;
  userId: string;
  role: ParticipantRole;
  joinedAt: string;
  leftAt?: string;
  lastReadAt?: string;
  unreadCount: number;
  typing: boolean;
}

export interface Conversation {
  id: string;
  orderId: string;
  /** UUID de la tienda (storeId de identity-service). */
  storeId: string;
  customerId: string;
  vendorId: string;
  status: ConversationStatus;
  participants: Participant[];
  lastMessageAt?: string;
  lastMessagePreview?: string;
  /**
   * Identidad visual del chat, tomada de identity-service (best-effort) al confirmarse
   * el pedido. Es una foto fija: no se re-sincroniza si luego cambian el logo/avatar.
   * El cliente ve nombre+logo de la tienda; el vendedor ve nombre+foto del cliente.
   */
  storeName?: string;
  storeLogoUrl?: string;
  customerName?: string;
  customerAvatarUrl?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface MessageReadStatus {
  messageId: string;
  participantId: string;
  readAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderRole: ParticipantRole;
  content: string;
  messageType: MessageType;
  status: MessageStatus;
  readStatuses: MessageReadStatus[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export const createParticipant = (conversationId: string, userId: string, role: ParticipantRole): Participant => ({
  conversationId,
  userId,
  role,
  joinedAt: new Date().toISOString(),
  unreadCount: 0,
  typing: false,
});

export const createConversation = (params: {
  orderId: string;
  storeId: string;
  customerId: string;
  vendorId: string;
  storeName?: string;
  storeLogoUrl?: string;
  customerName?: string;
  customerAvatarUrl?: string;
}): Conversation => {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  return {
    id,
    orderId: params.orderId,
    storeId: params.storeId,
    customerId: params.customerId,
    vendorId: params.vendorId,
    status: 'active',
    participants: [
      createParticipant(id, params.customerId, 'customer'),
      createParticipant(id, params.vendorId, 'vendor'),
    ],
    storeName: params.storeName,
    storeLogoUrl: params.storeLogoUrl,
    customerName: params.customerName,
    customerAvatarUrl: params.customerAvatarUrl,
    createdAt: now,
    updatedAt: now,
  };
};

export const createMessage = (params: {
  conversationId: string;
  senderId: string;
  senderRole: ParticipantRole;
  content: string;
  messageType?: MessageType;
}): Message => {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    conversationId: params.conversationId,
    senderId: params.senderId,
    senderRole: params.senderRole,
    content: params.content,
    messageType: params.messageType ?? 'text',
    status: 'sent',
    readStatuses: [],
    createdAt: now,
    updatedAt: now,
  };
};
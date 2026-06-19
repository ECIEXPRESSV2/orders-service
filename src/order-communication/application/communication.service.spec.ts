import { NotFoundException } from '@nestjs/common';
import { CommunicationService } from './communication.service';
import { RealtimeHubService } from '../../common/realtime-hub.service';
import type { CommunicationRepository } from './ports/communication.repository';
import type { EventPublisher } from './ports/event-publisher';
import type { Conversation, Message } from '../domain/communication.models';

const conversation = (): Conversation => ({
  id: 'conv-1',
  orderId: 'order-1',
  storeId: 'store-1',
  customerId: 'cust-1',
  vendorId: 'vendor-1',
  status: 'active',
  participants: [
    { conversationId: 'conv-1', userId: 'cust-1', role: 'customer', joinedAt: new Date().toISOString(), unreadCount: 0, typing: false },
    { conversationId: 'conv-1', userId: 'vendor-1', role: 'vendor', joinedAt: new Date().toISOString(), unreadCount: 0, typing: false },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

class FakeCommunicationRepository implements CommunicationRepository {
  conv = conversation();
  messages: Message[] = [];
  async findConversationById(id: string) { return id === this.conv.id ? this.conv : null; }
  async findConversationByOrderId() { return this.conv; }
  async listConversations() { return [this.conv]; }
  async saveConversation(c: Conversation) { this.conv = c; return c; }
  async getConversationMessages() { return this.messages; }
  async listMessages() { return { items: this.messages, total: this.messages.length }; }
  async saveMessage(m: Message) { this.messages.push(m); return m; }
  async markMessageAsRead(messageId: string) { return this.messages.find((m) => m.id === messageId) ?? null; }
  async setTyping() { /* noop */ }
  async incrementUnreadCounts() { /* noop */ }
  async joinConversation() { return this.conv; }
  async leaveConversation() { return this.conv; }
}

class FakeEventPublisher implements EventPublisher {
  events: Array<{ routingKey: string; payload: Record<string, unknown> }> = [];
  async publish(routingKey: string, payload: Record<string, unknown>) { this.events.push({ routingKey, payload }); }
}

describe('CommunicationService', () => {
  let repo: FakeCommunicationRepository;
  let events: FakeEventPublisher;
  let service: CommunicationService;

  beforeEach(() => {
    repo = new FakeCommunicationRepository();
    events = new FakeEventPublisher();
    service = new CommunicationService(repo, events, new RealtimeHubService());
  });

  it('envía un mensaje y emite order.chat.message.sent al destinatario correcto', async () => {
    const msg = await service.sendMessage({ conversationId: 'conv-1', senderId: 'cust-1', senderRole: 'customer', content: 'Hola' });
    expect(msg.content).toBe('Hola');
    expect(events.events).toHaveLength(1);
    expect(events.events[0].routingKey).toBe('order.chat.message.sent');
    // El comprador escribe -> el destinatario es el vendedor.
    expect(events.events[0].payload.recipientId).toBe('vendor-1');
  });

  it('falla si la conversación no existe', async () => {
    await expect(
      service.sendMessage({ conversationId: 'nope', senderId: 'cust-1', senderRole: 'customer', content: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

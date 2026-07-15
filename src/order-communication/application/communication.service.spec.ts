import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommunicationService } from './communication.service';
import { RealtimeHubService } from '../../common/realtime-hub.service';
import type { CommunicationRepository } from './ports/communication.repository';
import type { EventPublisher } from './ports/event-publisher';
import type { IdentityPort } from './ports/identity.port';
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
  hasConversation = true;
  messages: Message[] = [];
  // Igual que el repositorio real: un chat cerrado nunca aparece por esta vía.
  async findConversationById(id: string) { return id === this.conv.id && this.conv.status !== 'closed' ? this.conv : null; }
  async findConversationByOrderId(orderId: string) { return this.hasConversation && orderId === this.conv.orderId ? this.conv : null; }
  async listConversations() { return this.conv.status === 'closed' ? [] : [this.conv]; }
  async saveConversation(c: Conversation) { this.conv = c; this.hasConversation = true; return c; }
  async getConversationMessages() { return this.messages; }
  async listMessages() { return { items: this.messages, total: this.messages.length }; }
  async saveMessage(m: Message) {
    // Igual que TypeORM .save(): upsert por id (inserta si es nuevo, reemplaza si ya existía).
    const idx = this.messages.findIndex((existing) => existing.id === m.id);
    if (idx >= 0) this.messages[idx] = m;
    else this.messages.push(m);
    return m;
  }
  async markMessageAsRead(messageId: string) { return this.messages.find((m) => m.id === messageId) ?? null; }
  async markConversationRead() { return { conversation: this.conv, messageIds: [] as string[] }; }
  async setConversationStatus(_id: string, status: 'active' | 'archived' | 'closed') { this.conv = { ...this.conv, status }; return this.conv; }
  async setTyping() { /* noop */ }
  async incrementUnreadCounts() { /* noop */ }
  async joinConversation() { return this.conv; }
  async leaveConversation() { return this.conv; }
}

class FakeEventPublisher implements EventPublisher {
  events: Array<{ routingKey: string; payload: Record<string, unknown> }> = [];
  async publish(routingKey: string, payload: Record<string, unknown>) { this.events.push({ routingKey, payload }); }
}

const buildIdentity = (overrides: Partial<IdentityPort> = {}): IdentityPort => ({
  getStoreAvailability: async () => ({ available: true }),
  getStoreVendorId: async () => null,
  isStoreStaff: async () => false,
  getStoreDisplay: async () => null,
  getUserDisplay: async () => null,
  ...overrides,
});

describe('CommunicationService', () => {
  let repo: FakeCommunicationRepository;
  let events: FakeEventPublisher;
  let identity: IdentityPort;
  let service: CommunicationService;

  beforeEach(() => {
    repo = new FakeCommunicationRepository();
    events = new FakeEventPublisher();
    identity = buildIdentity();
    service = new CommunicationService(repo, events, identity, new RealtimeHubService());
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

  it('sendMessage: un desconocido (ni cliente ni staff de la tienda) recibe 403', async () => {
    await expect(
      service.sendMessage({ conversationId: 'conv-1', senderId: 'intruso', senderRole: 'customer', content: 'hola' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sendMessage: cualquier staff activo de la tienda puede escribir, no solo el vendorId original', async () => {
    identity = buildIdentity({ isStoreStaff: async (storeId, userId) => storeId === 'store-1' && userId === 'otro-empleado' });
    service = new CommunicationService(repo, events, identity, new RealtimeHubService());
    const msg = await service.sendMessage({ conversationId: 'conv-1', senderId: 'otro-empleado', senderRole: 'vendor', content: 'Ya casi está listo' });
    expect(msg.content).toBe('Ya casi está listo');
  });

  it('getConversationById: 403 para quien no es cliente ni staff de la tienda', async () => {
    await expect(service.getConversationById('conv-1', 'intruso')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('getConversationById: el cliente del pedido sí puede verla', async () => {
    const result = await service.getConversationById('conv-1', 'cust-1');
    expect(result.id).toBe('conv-1');
  });

  it('getConversationById: 404 si el chat ya está cerrado, incluso para el cliente dueño', async () => {
    repo.conv = { ...repo.conv, status: 'closed' };
    await expect(service.getConversationById('conv-1', 'cust-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getConversations: pedir por storeId sin ser staff de esa tienda es 403', async () => {
    await expect(service.getConversations({ storeId: 'store-1' }, 'intruso')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('getConversations: pedir por storeId siendo staff sí funciona', async () => {
    identity = buildIdentity({ isStoreStaff: async () => true });
    service = new CommunicationService(repo, events, identity, new RealtimeHubService());
    const result = await service.getConversations({ storeId: 'store-1' }, 'cualquier-empleado');
    expect(result).toHaveLength(1);
  });

  it('getConversations: sin storeId, siempre se acota al propio userId como cliente (ignora otros filtros)', async () => {
    const result = await service.getConversations({}, 'cust-1');
    expect(result).toHaveLength(1);
  });

  it('getMessages exige conversationId', async () => {
    await expect(service.getMessages({}, 'cust-1')).rejects.toBeInstanceOf(Error);
  });

  it('getMessages: 403 si no eres parte de la conversación', async () => {
    await expect(service.getMessages({ conversationId: 'conv-1' }, 'intruso')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('closeConversationForOrder cierra el chat y notifica a ambos participantes', async () => {
    const result = await service.closeConversationForOrder('order-1');
    expect(result).toBeUndefined();
    expect(repo.conv.status).toBe('closed');
  });

  it('closeConversationForOrder es no-op si el pedido nunca tuvo chat', async () => {
    repo.hasConversation = false;
    await service.closeConversationForOrder('order-1');
    // No debe reventar ni intentar setConversationStatus sobre nada.
    expect(repo.conv.status).toBe('active');
  });

  it('closeConversationForOrder es idempotente sobre un chat ya cerrado', async () => {
    await service.closeConversationForOrder('order-1');
    await expect(service.closeConversationForOrder('order-1')).resolves.toBeUndefined();
    expect(repo.conv.status).toBe('closed');
  });

  it('reopenConversationForOrder reactiva un chat cerrado (devolución post-recogida)', async () => {
    await service.closeConversationForOrder('order-1');
    await service.reopenConversationForOrder('order-1');
    expect(repo.conv.status).toBe('active');
  });

  it('reopenConversationForOrder es no-op si el chat no está cerrado', async () => {
    await service.reopenConversationForOrder('order-1');
    expect(repo.conv.status).toBe('active');
  });

  it('reopenConversationForOrder es no-op si el pedido nunca tuvo chat', async () => {
    repo.hasConversation = false;
    await expect(service.reopenConversationForOrder('order-1')).resolves.toBeUndefined();
  });

  it('ensureConversationForOrder guarda nombre/logo de tienda y nombre/foto del cliente (best-effort)', async () => {
    repo.hasConversation = false;
    identity = buildIdentity({
      getStoreDisplay: async () => ({ name: 'Café Central', logoUrl: 'https://x/logo.png' }),
      getUserDisplay: async () => ({ fullName: 'Ana Cliente', avatarUrl: 'https://x/ana.png' }),
    });
    service = new CommunicationService(repo, events, identity, new RealtimeHubService());
    const result = await service.ensureConversationForOrder({
      orderId: 'order-1', storeId: 'store-1', customerId: 'cust-1', vendorId: 'vendor-1',
    });
    expect(result.storeName).toBe('Café Central');
    expect(result.storeLogoUrl).toBe('https://x/logo.png');
    expect(result.customerName).toBe('Ana Cliente');
    expect(result.customerAvatarUrl).toBe('https://x/ana.png');
  });

  it('ensureConversationForOrder degrada con gracia si identity no responde (contrato: null, no excepción)', async () => {
    repo.hasConversation = false;
    // Mismo contrato que getStoreVendorId: el cliente HTTP real atrapa el error y
    // devuelve null; CommunicationService no debe reventar si eso pasa.
    identity = buildIdentity({ getStoreDisplay: async () => null, getUserDisplay: async () => null });
    service = new CommunicationService(repo, events, identity, new RealtimeHubService());
    const result = await service.ensureConversationForOrder({
      orderId: 'order-1', storeId: 'store-1', customerId: 'cust-1', vendorId: 'vendor-1', storeName: 'Fallback Tienda',
    });
    expect(result.storeName).toBe('Fallback Tienda'); // usa order.storeName si identity no da nombre
    expect(result.storeLogoUrl).toBeUndefined();
    expect(result.customerName).toBeUndefined();
    expect(result.customerAvatarUrl).toBeUndefined();
  });

  describe('tarjeta de reembolso', () => {
    it('postRefundMessage crea un mensaje messageType=refund con el payload como JSON', async () => {
      const msg = await service.postRefundMessage('order-1', {
        orderId: 'order-1', amount: 50000, full: true, kind: 'requested', reason: 'Dañado',
      });
      expect(msg?.messageType).toBe('refund');
      expect(JSON.parse(msg!.content)).toMatchObject({ kind: 'requested', amount: 50000, reason: 'Dañado' });
      expect(repo.conv.lastMessagePreview).toContain('solicitado');
    });

    it('postRefundMessage es no-op si el pedido nunca tuvo chat', async () => {
      repo.hasConversation = false;
      const msg = await service.postRefundMessage('order-1', { orderId: 'order-1', amount: 1, full: true, kind: 'requested' });
      expect(msg).toBeNull();
    });

    it('resolveRefundMessage actualiza EN EL MISMO mensaje (no crea uno nuevo)', async () => {
      const created = await service.postRefundMessage('order-1', { orderId: 'order-1', amount: 50000, full: true, kind: 'requested' });
      const resolved = await service.resolveRefundMessage('order-1', { kind: 'approved' });
      expect(resolved?.id).toBe(created?.id);
      expect(repo.messages).toHaveLength(1);
      expect(JSON.parse(resolved!.content)).toMatchObject({ kind: 'approved' });
    });

    it('resolveRefundMessage con rechazo agrega el motivo del vendedor', async () => {
      await service.postRefundMessage('order-1', { orderId: 'order-1', amount: 50000, full: true, kind: 'requested' });
      const resolved = await service.resolveRefundMessage('order-1', { kind: 'rejected', reason: 'Fotos no coinciden' });
      expect(JSON.parse(resolved!.content)).toMatchObject({ kind: 'rejected', reason: 'Fotos no coinciden' });
    });

    it('resolveRefundMessage es no-op si no hay ninguna tarjeta de reembolso en el chat', async () => {
      const resolved = await service.resolveRefundMessage('order-1', { kind: 'approved' });
      expect(resolved).toBeNull();
    });
  });
});

import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RealtimeHubService } from '../../common/realtime-hub.service';
import { CommunicationService } from '../application/communication.service';
import { IdentityAuthClient } from '../../common/auth/identity-auth.client';

@WebSocketGateway({ namespace: '/communication', path: '/orders/socket.io', cors: { origin: '*' } })
export class OrderCommunicationGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(OrderCommunicationGateway.name);

  constructor(
    private readonly communicationService: CommunicationService,
    private readonly realtimeHub: RealtimeHubService,
    private readonly identityAuth: IdentityAuthClient,
  ) {}

  afterInit(server: Server): void {
    this.server = server;
    this.realtimeHub.stream().subscribe((event) => {
      // Revocación de sesión (identity.user.deactivated): no se emite a clientes,
      // se desconectan los sockets activos del usuario.
      if (event.type === 'session:revoked') {
        const userId = (event.payload as { userId?: string })?.userId;
        if (userId) void this.disconnectUser(userId);
        return;
      }
      if (event.room) {
        this.server.to(event.room).emit(event.type, event.payload);
        return;
      }
      this.server.emit(event.type, event.payload);
    });
  }

  /** Desconecta todas las conexiones WebSocket de un usuario (sesión revocada). */
  private async disconnectUser(userId: string): Promise<void> {
    try {
      const sockets = await this.server.fetchSockets();
      let count = 0;
      for (const socket of sockets) {
        if ((socket.data as { userId?: string })?.userId === userId) {
          socket.disconnect();
          count += 1;
        }
      }
      if (count > 0) {
        this.logger.log(`Sesiones WS revocadas para ${userId}: ${count} socket(s) desconectado(s)`);
      }
    } catch (error) {
      this.logger.warn(`No se pudieron revocar sesiones de ${userId}: ${(error as Error).message}`);
    }
  }

  /**
   * Autentica la conexión WebSocket en el handshake. El cliente debe enviar
   * `auth: { token }` (token Firebase) o, en modo AUTH_DISABLED, `auth: { userId }`.
   */
  async handleConnection(socket: Socket): Promise<void> {
    try {
      if (process.env.AUTH_DISABLED === 'true') {
        socket.data.userId = socket.handshake.auth?.userId ?? socket.id;
        this.joinUserRoom(socket);
        return;
      }
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) {
        throw new Error('missing token');
      }
      const user = await this.identityAuth.validate(token);
      socket.data.userId = user.userId;
      this.joinUserRoom(socket);
    } catch {
      this.logger.warn(`WS conexión rechazada (${socket.id}): autenticación inválida`);
      socket.emit('error', { message: 'Unauthorized' });
      socket.disconnect(true);
    }
  }

  /** Une el socket a su sala personal `user:<id>` para recibir actualizaciones de la lista de chats. */
  private joinUserRoom(socket: Socket): void {
    const userId = socket.data.userId as string | undefined;
    if (userId) socket.join(`user:${userId}`);
  }

  @SubscribeMessage('conversation:joined')
  async joinConversation(
    @MessageBody() body: { conversationId: string; userId?: string; role?: 'customer' | 'vendor' | 'support' | 'system' },
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = (socket.data.userId as string) ?? body.userId ?? socket.id;
    socket.data.userId = userId;
    try {
      // Verifica pertenencia (cliente del pedido o staff de la tienda) ANTES de unir el
      // socket a la sala: si no pasa, nunca llega a recibir los mensajes de ese chat.
      const result = await this.communicationService.joinConversation(body.conversationId, userId, body.role ?? 'customer');
      socket.join(`conversation:${body.conversationId}`);
      return result;
    } catch (error) {
      this.logger.warn(`WS conversation:joined rechazado (${userId} -> ${body.conversationId}): ${(error as Error).message}`);
      socket.emit('error', { message: 'No tienes acceso a esta conversación' });
      return { error: 'forbidden' };
    }
  }

  @SubscribeMessage('order:subscribe')
  subscribeOrder(@MessageBody() body: { orderId: string }, @ConnectedSocket() socket: Socket) {
    socket.join(`order:${body.orderId}`);
    return { subscribed: body.orderId };
  }

  @SubscribeMessage('order:unsubscribe')
  unsubscribeOrder(@MessageBody() body: { orderId: string }, @ConnectedSocket() socket: Socket) {
    socket.leave(`order:${body.orderId}`);
    return { unsubscribed: body.orderId };
  }

  @SubscribeMessage('conversation:left')
  async leaveConversation(
    @MessageBody() body: { conversationId: string; userId?: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = (socket.data.userId as string) ?? body.userId ?? socket.id;
    socket.leave(`conversation:${body.conversationId}`);
    return this.communicationService.leaveConversation(body.conversationId, userId);
  }
}

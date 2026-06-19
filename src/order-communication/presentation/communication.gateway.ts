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

@WebSocketGateway({ namespace: '/communication', cors: { origin: '*' } })
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
      if (event.room) {
        this.server.to(event.room).emit(event.type, event.payload);
        return;
      }
      this.server.emit(event.type, event.payload);
    });
  }

  /**
   * Autentica la conexión WebSocket en el handshake. El cliente debe enviar
   * `auth: { token }` (token Firebase) o, en modo AUTH_DISABLED, `auth: { userId }`.
   */
  async handleConnection(socket: Socket): Promise<void> {
    try {
      if (process.env.AUTH_DISABLED === 'true') {
        socket.data.userId = socket.handshake.auth?.userId ?? socket.id;
        return;
      }
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) {
        throw new Error('missing token');
      }
      const user = await this.identityAuth.validate(token);
      socket.data.userId = user.userId;
    } catch {
      this.logger.warn(`WS conexión rechazada (${socket.id}): autenticación inválida`);
      socket.emit('error', { message: 'Unauthorized' });
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('conversation:joined')
  async joinConversation(
    @MessageBody() body: { conversationId: string; userId?: string; role?: 'customer' | 'vendor' | 'support' | 'system' },
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = (socket.data.userId as string) ?? body.userId ?? socket.id;
    socket.data.userId = userId;
    socket.join(`conversation:${body.conversationId}`);
    return this.communicationService.joinConversation(body.conversationId, userId, body.role ?? 'customer');
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

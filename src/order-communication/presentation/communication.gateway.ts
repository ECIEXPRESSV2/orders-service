import { ConnectedSocket, MessageBody, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RealtimeHubService } from '../../common/realtime-hub.service';
import { CommunicationService } from '../application/communication.service';

@WebSocketGateway({ namespace: '/communication', cors: { origin: '*' } })
export class OrderCommunicationGateway implements OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly communicationService: CommunicationService,
    private readonly realtimeHub: RealtimeHubService,
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

  @SubscribeMessage('conversation:joined')
  async joinConversation(@MessageBody() body: { conversationId: string; userId?: string; role?: 'customer' | 'vendor' | 'support' | 'system' }, @ConnectedSocket() socket: Socket) {
    const userId = body.userId ?? socket.data.userId ?? socket.id;
    socket.data.userId = userId;
    socket.join(`conversation:${body.conversationId}`);
    return this.communicationService.joinConversation(body.conversationId, userId, body.role ?? 'customer');
  }

  @SubscribeMessage('conversation:left')
  async leaveConversation(@MessageBody() body: { conversationId: string; userId?: string }, @ConnectedSocket() socket: Socket) {
    const userId = body.userId ?? socket.data.userId ?? socket.id;
    socket.leave(`conversation:${body.conversationId}`);
    return this.communicationService.leaveConversation(body.conversationId, userId);
  }
}
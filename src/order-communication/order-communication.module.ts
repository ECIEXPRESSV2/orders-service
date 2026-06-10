import { Module } from '@nestjs/common';
import { RealtimeHubService } from '../common/realtime-hub.service';
import { OrderCommunicationGateway } from './presentation/communication.gateway';
import { OrdersController } from './presentation/orders.controller';
import { ConversationsController } from './presentation/conversations.controller';
import { MessagesController } from './presentation/messages.controller';
import { OrdersService } from './application/orders.service';
import { CommunicationService } from './application/communication.service';
import { InMemoryOrderRepository } from './infrastructure/in-memory-order.repository';
import { InMemoryCommunicationRepository } from './infrastructure/in-memory-communication.repository';

@Module({
  controllers: [OrdersController, ConversationsController, MessagesController],
  providers: [
    RealtimeHubService,
    OrderCommunicationGateway,
    OrdersService,
    CommunicationService,
    InMemoryOrderRepository,
    InMemoryCommunicationRepository,
  ],
  exports: [OrdersService, CommunicationService, RealtimeHubService],
})
export class OrderCommunicationModule {}
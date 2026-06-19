import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RealtimeHubService } from '../common/realtime-hub.service';
import { OrderCommunicationGateway } from './presentation/communication.gateway';
import { OrdersController } from './presentation/orders.controller';
import { ConversationsController } from './presentation/conversations.controller';
import { MessagesController } from './presentation/messages.controller';
import { OrdersService } from './application/orders.service';
import { CommunicationService } from './application/communication.service';
import { ORDER_REPOSITORY } from './application/ports/order.repository';
import { COMMUNICATION_REPOSITORY } from './application/ports/communication.repository';
import { OrderEntity } from './infrastructure/persistence/order.entity';
import { OrderItemEntity } from './infrastructure/persistence/order-item.entity';
import { OrderStatusHistoryEntity } from './infrastructure/persistence/order-status-history.entity';
import { OrderRatingEntity } from './infrastructure/persistence/order-rating.entity';
import { ConversationEntity } from './infrastructure/persistence/conversation.entity';
import { ParticipantEntity } from './infrastructure/persistence/participant.entity';
import { MessageEntity } from './infrastructure/persistence/message.entity';
import { OutboxEventEntity } from './infrastructure/persistence/outbox-event.entity';
import { ProcessedEventEntity } from './infrastructure/persistence/processed-event.entity';
import { TypeOrmOrderRepository } from './infrastructure/persistence/typeorm-order.repository';
import { TypeOrmCommunicationRepository } from './infrastructure/persistence/typeorm-communication.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderEntity,
      OrderItemEntity,
      OrderStatusHistoryEntity,
      OrderRatingEntity,
      ConversationEntity,
      ParticipantEntity,
      MessageEntity,
      OutboxEventEntity,
      ProcessedEventEntity,
    ]),
  ],
  controllers: [OrdersController, ConversationsController, MessagesController],
  providers: [
    RealtimeHubService,
    OrderCommunicationGateway,
    OrdersService,
    CommunicationService,
    { provide: ORDER_REPOSITORY, useClass: TypeOrmOrderRepository },
    { provide: COMMUNICATION_REPOSITORY, useClass: TypeOrmCommunicationRepository },
  ],
  exports: [OrdersService, CommunicationService, RealtimeHubService],
})
export class OrderCommunicationModule {}

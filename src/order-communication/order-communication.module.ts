import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RealtimeHubService } from '../common/realtime-hub.service';
import { FirebaseAuthGuard } from '../common/auth/firebase-auth.guard';
import { IdentityAuthClient } from '../common/auth/identity-auth.client';
import { OrderCommunicationGateway } from './presentation/communication.gateway';
import { OrdersController } from './presentation/orders.controller';
import { ConversationsController } from './presentation/conversations.controller';
import { MessagesController } from './presentation/messages.controller';
import { OrdersService } from './application/orders.service';
import { CommunicationService } from './application/communication.service';
import { StoreDirectoryService } from './application/store-directory.service';
import { ORDER_REPOSITORY } from './application/ports/order.repository';
import { COMMUNICATION_REPOSITORY } from './application/ports/communication.repository';
import { EVENT_PUBLISHER } from './application/ports/event-publisher';
import { IDENTITY_PORT } from './application/ports/identity.port';
import { PRODUCTS_PORT } from './application/ports/products.port';
import { IdentityHttpClient } from './infrastructure/clients/identity-http.client';
import { ProductsMockClient } from './infrastructure/clients/products.mock.client';
import { ProductsHttpClient } from './infrastructure/clients/products-http.client';
import { RabbitMQService } from './infrastructure/messaging/rabbitmq.service';
import { OutboxService } from './infrastructure/messaging/outbox.service';
import { OutboxWorker } from './infrastructure/messaging/outbox.worker';
import { EventConsumerService } from './infrastructure/messaging/event-consumer.service';
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
    StoreDirectoryService,
    IdentityAuthClient,
    FirebaseAuthGuard,
    RabbitMQService,
    OutboxWorker,
    EventConsumerService,
    { provide: ORDER_REPOSITORY, useClass: TypeOrmOrderRepository },
    { provide: COMMUNICATION_REPOSITORY, useClass: TypeOrmCommunicationRepository },
    { provide: EVENT_PUBLISHER, useClass: OutboxService },
    { provide: IDENTITY_PORT, useClass: IdentityHttpClient },
    {
      // products-service aún no expone productos -> mock por defecto.
      provide: PRODUCTS_PORT,
      useClass: process.env.USE_PRODUCTS_MOCK === 'false' ? ProductsHttpClient : ProductsMockClient,
    },
  ],
  exports: [OrdersService, CommunicationService, RealtimeHubService, IdentityAuthClient],
})
export class OrderCommunicationModule {}

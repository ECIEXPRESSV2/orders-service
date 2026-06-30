import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { buildTypeOrmOptions } from './config/typeorm.options';
import { LoggingMiddleware } from './common/logger/logging.middleware';
import { OrderCommunicationModule } from './order-communication/order-communication.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({ ...buildTypeOrmOptions(), autoLoadEntities: true }),
    }),
    OrderCommunicationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Rellena el userId (header x-user-id) en el contexto de logging para que cada
    // log enviado a Application Insights incluya customDimensions.userId.
    consumer.apply(LoggingMiddleware).forRoutes('*');
  }
}

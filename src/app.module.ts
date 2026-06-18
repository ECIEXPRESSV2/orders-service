import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { OrderCommunicationModule } from './order-communication/order-communication.module';

@Module({
  imports: [OrderCommunicationModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

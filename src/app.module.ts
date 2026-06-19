import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { buildTypeOrmOptions } from './config/typeorm.options';
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
export class AppModule {}

import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): { message: string; service: string; status: string } {
    return {
      message: 'ECIXPRESS Order & Communication Service',
      service: 'orders-service',
      status: 'ok',
    };
  }
}

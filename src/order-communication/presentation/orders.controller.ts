import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrdersService } from '../application/orders.service';
import { CancelOrderDto, CreateOrderDto, RateOrderDto, UpdateOrderStatusDto } from '../application/orders.dto';
import { FirebaseAuthGuard } from '../../common/auth/firebase-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth-user';

@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(FirebaseAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Create order' })
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: AuthUser) {
    // El comprador siempre es el usuario autenticado, no lo que venga en el body.
    return this.ordersService.createOrder({ ...dto, customerId: user.userId });
  }

  @Get()
  @ApiOperation({ summary: 'List orders' })
  findAll(@Query('customerId') customerId?: string, @Query('status') status?: string) {
    return this.ordersService.getOrders({ customerId, status });
  }

  @Get('history')
  @ApiOperation({ summary: 'Get order history' })
  history(@CurrentUser() user: AuthUser, @Query('customerId') customerId?: string) {
    return this.ordersService.getHistory(customerId ?? user.userId);
  }

  @Get('frequent')
  @ApiOperation({ summary: 'Get frequent orders' })
  frequent(@CurrentUser() user: AuthUser, @Query('customerId') customerId?: string) {
    return this.ordersService.getFrequent(customerId ?? user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get order by id' })
  findOne(@Param('id') id: string) {
    return this.ordersService.getOrderById(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update order status' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto, @CurrentUser() user: AuthUser) {
    return this.ordersService.updateOrderStatus(id, { ...dto, actorId: dto.actorId ?? user.userId });
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel order' })
  cancel(@Param('id') id: string, @Body() dto: CancelOrderDto, @CurrentUser() user: AuthUser) {
    return this.ordersService.cancelOrder(id, {
      ...dto,
      actorType: dto.actorType ?? 'customer',
      actorId: dto.actorId ?? user.userId,
    });
  }

  @Post(':id/rating')
  @ApiOperation({ summary: 'Rate order' })
  rate(@Param('id') id: string, @Body() dto: RateOrderDto, @CurrentUser() user: AuthUser) {
    return this.ordersService.rateOrder(id, { ...dto, customerId: user.userId });
  }
}

import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrdersService } from '../application/orders.service';
import {
  CancelOrderDto,
  CreateDraftDto,
  CreateOrderDto,
  RateOrderDto,
  RequestReturnDto,
  UpdateOrderStatusDto,
  UpsertCartItemDto,
} from '../application/orders.dto';
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
  create(
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: AuthUser,
    @Headers('Idempotency-Key') idempotencyKey?: string,
  ) {
    // El comprador siempre es el usuario autenticado, no lo que venga en el body.
    // La clave de idempotencia llega por header (estándar); cae al body si no viene.
    return this.ordersService.createOrder({
      ...dto,
      customerId: user.userId,
      idempotencyKey: idempotencyKey ?? dto.idempotencyKey,
    });
  }

  @Post('draft')
  @ApiOperation({ summary: 'Create a cart (DRAFT order) for a store' })
  createDraft(@Body() dto: CreateDraftDto, @CurrentUser() user: AuthUser) {
    return this.ordersService.createDraft({ ...dto, customerId: user.userId });
  }

  @Post(':id/items')
  @ApiOperation({ summary: 'Add/update/remove a cart line (quantity 0 removes)' })
  setCartItem(@Param('id') id: string, @Body() dto: UpsertCartItemDto) {
    return this.ordersService.setCartItem(id, dto);
  }

  @Post(':id/checkout')
  @ApiOperation({ summary: 'Check out a cart: move to payment and charge wallet' })
  checkout(@Param('id') id: string) {
    return this.ordersService.checkout(id);
  }

  @Post(':id/returns')
  @ApiOperation({ summary: 'Request a return (full or partial) for an order' })
  requestReturn(@Param('id') id: string, @Body() dto: RequestReturnDto) {
    return this.ordersService.requestReturn(id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List orders' })
  findAll(
    @Query('customerId') customerId?: string,
    @Query('storeId') storeId?: string,
    @Query('status') status?: string,
  ) {
    return this.ordersService.getOrders({ customerId, storeId, status });
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

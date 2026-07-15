import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Query, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrdersService } from '../application/orders.service';
import { ReturnEvidenceService, MAX_IMAGE_BYTES, type UploadedImage } from '../application/return-evidence.service';
import {
  CancelOrderDto,
  CheckoutDto,
  CreateDraftDto,
  CreateOrderDto,
  QuoteCartDto,
  RateOrderDto,
  RejectReturnDto,
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
  constructor(
    private readonly ordersService: OrdersService,
    private readonly returnEvidence: ReturnEvidenceService,
  ) {}

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

  @Post(':id/quote')
  @ApiOperation({ summary: 'Quote a cart synchronously (price + stock) for the invoice/confirm step' })
  quote(@Param('id') id: string, @Body() dto: QuoteCartDto) {
    return this.ordersService.quoteCart(id, dto);
  }

  @Post(':id/checkout')
  @ApiOperation({ summary: 'Check out a cart: move to payment and charge wallet' })
  checkout(@Param('id') id: string, @Body() dto: CheckoutDto) {
    return this.ordersService.checkout(id, dto.scheduledPickupAt, dto.closeTime);
  }

  @Post(':id/returns')
  @ApiOperation({ summary: 'Request a return (full or partial) for an order' })
  requestReturn(@Param('id') id: string, @Body() dto: RequestReturnDto) {
    return this.ordersService.requestReturn(id, dto);
  }

  @Post(':id/returns/evidence')
  @UseInterceptors(FilesInterceptor('files', 3, { limits: { fileSize: MAX_IMAGE_BYTES } }))
  @ApiOperation({ summary: 'Buyer: upload up to 3 evidence photos for a return request (before calling POST returns)' })
  uploadReturnEvidence(
    @Param('id') id: string,
    @Body('refundId') refundId: string,
    @UploadedFiles() files: UploadedImage[],
    @CurrentUser() user: AuthUser,
  ) {
    return this.returnEvidence.upload(id, user.userId, refundId, files);
  }

  @Get(':id/returns/evidence/:refundId')
  @ApiOperation({ summary: 'Buyer or store staff: fetch fresh read URLs for a return evidence set' })
  getReturnEvidence(@Param('id') id: string, @Param('refundId') refundId: string, @CurrentUser() user: AuthUser) {
    return this.returnEvidence.list(id, user.userId, refundId);
  }

  @Post(':id/returns/approve')
  @ApiOperation({ summary: 'Store staff: approve a post-pickup return pending approval' })
  approveReturn(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.ordersService.approveReturn(id, user.userId);
  }

  @Post(':id/returns/reject')
  @ApiOperation({ summary: 'Store staff: reject a post-pickup return pending approval' })
  rejectReturn(@Param('id') id: string, @Body() dto: RejectReturnDto, @CurrentUser() user: AuthUser) {
    return this.ordersService.rejectReturn(id, user.userId, dto?.reason);
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

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete order permanently (only DELIVERED, CANCELLED or FAILED)' })
  remove(@Param('id') id: string) {
    return this.ordersService.deleteOrder(id);
  }
}

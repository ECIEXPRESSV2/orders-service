import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrdersService } from '../application/orders.service';
import { CancelOrderDto, CreateOrderDto, RateOrderDto, UpdateOrderStatusDto } from '../application/orders.dto';

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Create order' })
  create(@Body() dto: CreateOrderDto) {
    return this.ordersService.createOrder(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List orders' })
  findAll(@Query('customerId') customerId?: string, @Query('status') status?: string) {
    return this.ordersService.getOrders({ customerId, status });
  }

  @Get('history')
  @ApiOperation({ summary: 'Get order history' })
  history(@Query('customerId') customerId?: string) {
    return this.ordersService.getHistory(customerId);
  }

  @Get('frequent')
  @ApiOperation({ summary: 'Get frequent orders' })
  frequent(@Query('customerId') customerId?: string) {
    return this.ordersService.getFrequent(customerId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get order by id' })
  findOne(@Param('id') id: string) {
    return this.ordersService.getOrderById(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update order status' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.ordersService.updateOrderStatus(id, dto);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel order' })
  cancel(@Param('id') id: string, @Body() dto: CancelOrderDto) {
    return this.ordersService.cancelOrder(id, dto);
  }

  @Post(':id/rating')
  @ApiOperation({ summary: 'Rate order' })
  rate(@Param('id') id: string, @Body() dto: RateOrderDto) {
    return this.ordersService.rateOrder(id, dto);
  }
}
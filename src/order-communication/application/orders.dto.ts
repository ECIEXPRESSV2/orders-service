import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { OrderDeliveryMethod, OrderPaymentMethod, OrderSource, OrderStatus } from '../domain/order.models';

export class CreateOrderItemDto {
  @ApiProperty({ example: '6f3a2b1c-0d4e-4f5a-9b6c-7d8e9f0a1b2c', description: 'UUID del producto' })
  productId!: string;

  @ApiProperty({ example: 'Combo Hamburguesa' })
  name!: string;

  @ApiPropertyOptional({ example: 'Hamburguesa con papas y gaseosa' })
  description?: string;

  @ApiPropertyOptional({ example: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=200&auto=format&fit=crop' })
  imageUrl?: string;

  @ApiProperty({ example: 1500000, description: 'Precio unitario en centavos COP' })
  unitPrice!: number;

  @ApiProperty({ example: 1 })
  quantity!: number;
}

export class CreateOrderDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', description: 'UUID del comprador (se ignora si hay token; se toma del usuario autenticado)' })
  customerId!: string;

  @ApiProperty({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', description: 'UUID de la tienda' })
  storeId!: string;

  @ApiProperty({ example: 'Café Central' })
  storeName!: string;

  @ApiProperty({ type: [CreateOrderItemDto] })
  items!: CreateOrderItemDto[];

  @ApiProperty({ example: 'wallet', enum: ['cash', 'wallet', 'card', 'transfer'] })
  paymentMethod!: OrderPaymentMethod;

  @ApiProperty({ example: 'pickup', enum: ['pickup', 'delivery'] })
  deliveryMethod!: OrderDeliveryMethod;

  @ApiProperty({ example: 'COP' })
  currency!: string;

  @ApiPropertyOptional({ example: 'Sin mayonesa' })
  notes?: string;

  @ApiPropertyOptional({ example: 'web', enum: ['web', 'mobile', 'admin'] })
  source?: OrderSource;

  @ApiPropertyOptional({ example: 0 })
  discountAmount?: number;
}

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: ['CREATED', 'PENDING_PAYMENT', 'PAYMENT_APPROVED', 'CONFIRMED', 'IN_PREPARATION', 'READY_FOR_PICKUP', 'DELIVERED', 'CANCELLED', 'FAILED'] })
  status!: OrderStatus;

  @ApiProperty({ example: 'vendor' })
  actorType!: string;

  @ApiPropertyOptional({ example: 'store-operator-1' })
  actorId?: string;

  @ApiPropertyOptional({ example: 'Prepared by kitchen' })
  reason?: string;
}

export class CancelOrderDto {
  @ApiProperty({ example: 'customer' })
  actorType!: string;

  @ApiPropertyOptional({ example: 'customer-1' })
  actorId?: string;

  @ApiPropertyOptional({ example: 'Changed my mind' })
  reason?: string;
}

export class RateOrderDto {
  @ApiProperty({ example: 'student-001' })
  customerId!: string;

  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  score!: number;

  @ApiPropertyOptional({ example: 'Very fast service' })
  comment?: string;
}

export class OrderResponseDto {
  id!: string;
  orderNumber!: string;
  customerId!: string;
  storeId!: string;
  storeName!: string;
  status!: OrderStatus;
  paymentMethod!: OrderPaymentMethod;
  deliveryMethod!: OrderDeliveryMethod;
  currency!: string;
  source!: OrderSource;
  notes?: string;
  subtotalAmount!: number;
  discountAmount!: number;
  totalAmount!: number;
  items!: CreateOrderItemDto[];
  statusHistory!: Array<{
    id: string;
    orderId: string;
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    actorType: string;
    actorId?: string;
    reason?: string;
    occurredAt: string;
  }>;
  rating?: {
    id: string;
    orderId: string;
    customerId: string;
    score: number;
    comment?: string;
    createdAt: string;
    updatedAt: string;
  };
  pickupExpiresAt?: string;
  createdAt!: string;
  updatedAt!: string;
  cancelledAt?: string;
}

export class FrequentProductDto {
  productId!: string;
  name!: string;
  imageUrl?: string;
  totalOrders!: number;
}
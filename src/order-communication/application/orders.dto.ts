import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ORDER_ACTOR_TYPES,
  ORDER_DELIVERY_METHODS,
  ORDER_PAYMENT_METHODS,
  ORDER_SOURCES,
  ORDER_STATUS_VALUES,
} from '../domain/order.models';
import type { OrderDeliveryMethod, OrderPaymentMethod, OrderSource, OrderStatus } from '../domain/order.models';

export class CreateOrderItemDto {
  @ApiProperty({ example: '6f3a2b1c-0d4e-4f5a-9b6c-7d8e9f0a1b2c', description: 'UUID del producto' })
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ example: 'Combo Hamburguesa' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: 'Hamburguesa con papas y gaseosa' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd' })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiProperty({ example: 1500000, description: 'Precio unitario en centavos COP' })
  @IsInt()
  @Min(0)
  unitPrice!: number;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateOrderDto {
  @ApiPropertyOptional({ description: 'UUID del comprador. Se ignora si hay token: se toma del usuario autenticado.' })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiProperty({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', description: 'UUID de la tienda (identity-service)' })
  @IsUUID()
  storeId!: string;

  @ApiProperty({ example: 'Café Central' })
  @IsString()
  @IsNotEmpty()
  storeName!: string;

  @ApiProperty({ type: [CreateOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];

  @ApiProperty({ example: 'wallet', enum: ORDER_PAYMENT_METHODS })
  @IsIn(ORDER_PAYMENT_METHODS)
  paymentMethod!: OrderPaymentMethod;

  @ApiProperty({ example: 'pickup', enum: ORDER_DELIVERY_METHODS })
  @IsIn(ORDER_DELIVERY_METHODS)
  deliveryMethod!: OrderDeliveryMethod;

  @ApiProperty({ example: 'COP' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  currency!: string;

  @ApiPropertyOptional({ example: 'Sin mayonesa' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ example: 'web', enum: ORDER_SOURCES })
  @IsOptional()
  @IsIn(ORDER_SOURCES)
  source?: OrderSource;

  @ApiPropertyOptional({ example: 0, description: 'Descuento en centavos COP' })
  @IsOptional()
  @IsInt()
  @Min(0)
  discountAmount?: number;
}

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: ORDER_STATUS_VALUES })
  @IsIn(ORDER_STATUS_VALUES)
  status!: OrderStatus;

  @ApiProperty({ example: 'vendor', enum: ORDER_ACTOR_TYPES })
  @IsIn(ORDER_ACTOR_TYPES)
  actorType!: string;

  @ApiPropertyOptional({ example: 'store-operator-1' })
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiPropertyOptional({ example: 'Prepared by kitchen' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CancelOrderDto {
  @ApiPropertyOptional({ example: 'customer', enum: ORDER_ACTOR_TYPES })
  @IsOptional()
  @IsIn(ORDER_ACTOR_TYPES)
  actorType?: string;

  @ApiPropertyOptional({ example: 'customer-1' })
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiPropertyOptional({ example: 'Changed my mind' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RateOrderDto {
  @ApiPropertyOptional({ description: 'UUID del comprador. Se ignora si hay token.' })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  score!: number;

  @ApiPropertyOptional({ example: 'Very fast service' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
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

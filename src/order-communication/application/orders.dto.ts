import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Matches,
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

  @ApiPropertyOptional({ example: 'Sin cebolla', description: 'Observación del comprador para esta línea' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;

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

export class QuoteCartItemDto {
  @ApiProperty({ example: '6f3a2b1c-0d4e-4f5a-9b6c-7d8e9f0a1b2c', description: 'UUID del producto' })
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ example: 'Mouse' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;
}

/**
 * Cuerpo de `POST /orders/:id/quote`. El front envía las cantidades AUTORITATIVAS del carrito
 * (su fuente de verdad) para que el paso "Confirmar" fije `order.items` a exactamente eso antes
 * de cotizar — así el modal/factura siempre refleja el carrito, sin depender de la consistencia
 * de las escrituras incrementales previas.
 */
export class QuoteCartDto {
  @ApiProperty({ type: [QuoteCartItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuoteCartItemDto)
  items!: QuoteCartItemDto[];
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

  @ApiPropertyOptional({ example: '2026-06-21T15:30:00.000Z', description: 'Hora de recogida programada (ISO-8601)' })
  @IsOptional()
  @IsISO8601()
  scheduledPickupAt?: string;

  @ApiPropertyOptional({ description: 'Clave de idempotencia; normalmente se envía en el header Idempotency-Key.' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class CreateDraftDto {
  @ApiPropertyOptional({ description: 'UUID del comprador. Se ignora si hay token: se toma del usuario autenticado.' })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiProperty({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', description: 'UUID de la tienda' })
  @IsUUID()
  storeId!: string;

  @ApiProperty({ example: 'Café Central' })
  @IsString()
  @IsNotEmpty()
  storeName!: string;

  @ApiProperty({ example: 'wallet', enum: ORDER_PAYMENT_METHODS })
  @IsIn(ORDER_PAYMENT_METHODS)
  paymentMethod!: OrderPaymentMethod;

  @ApiProperty({ example: 'pickup', enum: ORDER_DELIVERY_METHODS })
  @IsIn(ORDER_DELIVERY_METHODS)
  deliveryMethod!: OrderDeliveryMethod;

  @ApiPropertyOptional({ example: 'COP' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @ApiPropertyOptional({ example: 'web', enum: ORDER_SOURCES })
  @IsOptional()
  @IsIn(ORDER_SOURCES)
  source?: OrderSource;

  @ApiPropertyOptional({ example: 'Sin mayonesa' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ example: '2026-06-21T15:30:00.000Z', description: 'Hora de recogida programada (ISO-8601)' })
  @IsOptional()
  @IsISO8601()
  scheduledPickupAt?: string;
}

export class CheckoutDto {
  @ApiPropertyOptional({ example: '2026-06-21T15:30:00.000Z', description: 'Hora de recogida programada (ISO-8601)' })
  @IsOptional()
  @IsISO8601()
  scheduledPickupAt?: string;

  @ApiPropertyOptional({ example: '18:00', description: 'Hora de cierre de la tienda (HH:mm)' })
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  closeTime?: string;
}

export class UpsertCartItemDto {
  @ApiProperty({ example: '6f3a2b1c-0d4e-4f5a-9b6c-7d8e9f0a1b2c', description: 'UUID del producto' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: 2, description: 'Cantidad deseada. 0 elimina la línea del carrito.' })
  @IsInt()
  @Min(0)
  quantity!: number;

  @ApiPropertyOptional({ example: 'Combo Hamburguesa', description: 'Nombre para mostrar mientras products cotiza.' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'Sin cebolla', description: 'Observación del comprador para esta línea' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;

  @ApiPropertyOptional({ example: 'https://images.example.com/combo.jpg' })
  @IsOptional()
  @IsString()
  imageUrl?: string;
}

export class ReturnItemDto {
  @ApiProperty({ example: '6f3a2b1c-0d4e-4f5a-9b6c-7d8e9f0a1b2c', description: 'UUID del producto a devolver' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: 1, description: 'Cantidad a devolver' })
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class RequestReturnDto {
  @ApiPropertyOptional({ example: false, description: 'true = devolución total; ignora `items`.' })
  @IsOptional()
  full?: boolean;

  @ApiPropertyOptional({ type: [ReturnItemDto], description: 'Productos y cantidades a devolver (devolución parcial).' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items?: ReturnItemDto[];

  @ApiPropertyOptional({ example: 'Producto en mal estado' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'Id generado por el cliente para la carpeta de evidencia subida vía POST :id/returns/evidence (opcional, sin fotos se omite).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  refundId?: string;
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

export class RejectReturnDto {
  @ApiPropertyOptional({ example: 'Las fotos no corresponden al producto reportado' })
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
  scheduledPickupAt?: string;
  /** Hora estimada en que el pedido estará listo (programada o createdAt + preparación). */
  estimatedReadyAt?: string;
  pickupExpiresAt?: string;
  createdAt!: string;
  updatedAt!: string;
  cancelledAt?: string;
  /** Devolución cotizada por products, pendiente de aprobación de admin (status RETURN_PENDING_APPROVAL). */
  pendingReturnAmount?: number;
  pendingReturnFull?: boolean;
}

export class FrequentProductDto {
  productId!: string;
  name!: string;
  imageUrl?: string;
  totalOrders!: number;
}

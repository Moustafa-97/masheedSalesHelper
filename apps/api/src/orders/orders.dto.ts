import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DocumentType, OrderStatus, PaymentMethod } from './order.entities.js';

const price = { maxDecimalPlaces: 2 } as const;
const qty = { maxDecimalPlaces: 3 } as const;

/* ---------- Projects ---------- */

export class ProjectDto {
  @IsString() @MinLength(1) @MaxLength(160) name: string;
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(1000) mapsUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) contacts?: string | null;
}

export class UpdateProjectDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) name?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(1000) mapsUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) contacts?: string | null;
  @IsOptional() isActive?: boolean;
}

/* ---------- Orders ---------- */

export class OrderLineDto {
  @IsUUID() variantId: string;
  @IsNumber(qty) @Min(0.001) qty: number;
  /** Excl. VAT */
  @IsNumber(price) @Min(0) unitPrice: number;
  @IsOptional() @IsNumber(price) @Min(0) purchasePrice?: number | null;
  @IsOptional() @IsString() @MaxLength(60) color?: string | null;
  /** Required when qty is below the item's minimum. */
  @IsOptional() @IsString() @MaxLength(500) belowMinReason?: string | null;
}

export class CreateOrderDto {
  @IsString() @MinLength(1) @MaxLength(40) number: string;
  @IsUUID() clientId: string;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsDateString({ strict: true }) orderDate: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
  @ValidateNested({ each: true }) @Type(() => OrderLineDto) @ArrayMinSize(1) @ArrayMaxSize(100)
  lines: OrderLineDto[];
}

export class UpdateOrderDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40) number?: string;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsDateString({ strict: true }) orderDate?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
}

export class UpdateLineDto {
  @IsOptional() @IsNumber(qty) @Min(0.001) qty?: number;
  @IsOptional() @IsNumber(price) @Min(0) unitPrice?: number;
  @IsOptional() @IsNumber(price) @Min(0) purchasePrice?: number | null;
  @IsOptional() @IsString() @MaxLength(60) color?: string | null;
  @IsOptional() @IsString() @MaxLength(500) belowMinReason?: string | null;
}

export class ReasonDto {
  @IsString() @MinLength(2) @MaxLength(500) reason: string;
}

export class PurchasePriceDto {
  /** Applied to every line that isn't removed. */
  @IsNumber(price) @Min(0) purchasePrice: number;
}

export class StatusDto {
  @IsEnum(OrderStatus) status: OrderStatus;
}

export class ListOrdersQuery {
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsDateString({ strict: true }) from?: string;
  @IsOptional() @IsDateString({ strict: true }) to?: string;
}

/* ---------- Documents, deliveries, invoices, payments ---------- */

export class AddDocumentDto {
  @IsUUID() fileId: string;
  @IsEnum(DocumentType) type: DocumentType;
  @IsOptional() @IsString() @MaxLength(80) reference?: string | null;
}

export class DeliveryLineDto {
  @IsUUID() orderLineId: string;
  @IsNumber(qty) @Min(0.001) qty: number;
}

export class AddDeliveryDto {
  @IsDateString({ strict: true }) date: string;
  @IsOptional() @IsString() @MaxLength(80) reference?: string | null;
  /** An uploaded DELIVERY_NOTE document of this order. */
  @IsOptional() @IsUUID() documentId?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
  @ValidateNested({ each: true }) @Type(() => DeliveryLineDto) @ArrayMinSize(1) @ArrayMaxSize(100)
  lines: DeliveryLineDto[];
}

export class AddInvoiceDto {
  @IsString() @MinLength(1) @MaxLength(60) number: string;
  @IsDateString({ strict: true }) date: string;
  /** Incl. VAT */
  @IsNumber(price) @Min(0) amount: number;
  @IsOptional() @IsUUID() documentId?: string | null;
}

export class AddPaymentDto {
  @IsNumber(price) @Min(0.01) amount: number;
  @IsDateString({ strict: true }) date: string;
  @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  @IsOptional() @IsString() @MaxLength(80) reference?: string | null;
  @IsOptional() @IsUUID() fileId?: string | null;
  @IsOptional() @IsUUID() orderId?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}

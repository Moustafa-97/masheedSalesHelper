import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Client } from '../clients/client.entity.js';
import { numericTransformer } from '../database/transformers.js';
import { ProductVariant, Unit } from '../products/product.entities.js';
import type { User } from '../users/user.entity.js';

const money = { type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer } as const;
const quantity = { type: 'numeric', precision: 12, scale: 3, transformer: numericTransformer } as const;

/** Any uploaded file: PO, delivery note, invoice, transfer receipt. Bytes live in file storage. */
@Entity('files')
export class StoredFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Where the bytes are in storage (local folder now, object storage later). */
  @Column({ type: 'varchar', length: 300, select: false })
  storageKey: string;

  @Column({ type: 'varchar', length: 255 })
  originalName: string;

  @Column({ type: 'varchar', length: 120 })
  mimeType: string;

  @Column({ type: 'int' })
  size: number;

  @Column({ type: 'uuid' })
  uploadedById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

/** A client's site: where orders are delivered and who to call there. */
@Entity('client_projects')
@Index(['clientId', 'name'], { unique: true })
export class ClientProject {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  clientId: string;

  @ManyToOne('Client', { onDelete: 'CASCADE' })
  client: Client;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  /** Google Maps link to the site. */
  @Column({ type: 'varchar', length: 1000, nullable: true })
  mapsUrl: string | null;

  /** Names and phone numbers at the site, free text, one per line. */
  @Column({ type: 'text', nullable: true })
  contacts: string | null;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

export enum OrderStatus {
  NEW = 'NEW',
  SENT_TO_SUPPLY = 'SENT_TO_SUPPLY',
  SUPPLY_RECEIVED = 'SUPPLY_RECEIVED',
  AT_SUPPLIER = 'AT_SUPPLIER',
  IN_TRANSIT = 'IN_TRANSIT',
  /** Every line fully received, with delivery notes and purchase invoices uploaded. */
  DELIVERED = 'DELIVERED',
  /** Delivered and at least one sales invoice recorded. */
  INVOICED = 'INVOICED',
  CANCELLED = 'CANCELLED',
}

/** Steps in order; CANCELLED sits outside the flow. */
export const ORDER_FLOW: OrderStatus[] = [
  OrderStatus.NEW,
  OrderStatus.SENT_TO_SUPPLY,
  OrderStatus.SUPPLY_RECEIVED,
  OrderStatus.AT_SUPPLIER,
  OrderStatus.IN_TRANSIT,
  OrderStatus.DELIVERED,
  OrderStatus.INVOICED,
];

@Entity('orders')
@Index(['clientId', 'orderDate'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Masheed's sales order number, typed by the rep (e.g. SO/26/001234). */
  @Column({ type: 'varchar', length: 40, unique: true })
  number: string;

  @Column({ type: 'uuid' })
  clientId: string;

  @ManyToOne('Client', { onDelete: 'RESTRICT' })
  client: Client;

  @Column({ type: 'uuid', nullable: true })
  projectId: string | null;

  @ManyToOne(() => ClientProject, { onDelete: 'RESTRICT', nullable: true })
  project: ClientProject | null;

  /** Who created the order. */
  @Column({ type: 'uuid' })
  createdById: string;

  @ManyToOne('User', { onDelete: 'RESTRICT' })
  createdBy: User;

  /** The due date counts from this date (+ the client's payment terms). */
  @Column({ type: 'date' })
  orderDate: string;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.NEW })
  status: OrderStatus;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 15, transformer: numericTransformer })
  vatRate: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'text', nullable: true })
  cancelReason: string | null;

  @OneToMany(() => OrderLine, (l) => l.order)
  lines: OrderLine[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('order_lines')
export class OrderLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, (o) => o.lines, { onDelete: 'CASCADE' })
  order: Order;

  @Column({ type: 'uuid' })
  variantId: string;

  @ManyToOne(() => ProductVariant, { onDelete: 'RESTRICT' })
  variant: ProductVariant;

  /** Product and brand as they were when ordered, so renames don't change old orders. */
  @Column({ type: 'varchar', length: 300 })
  description: string;

  @Column({ type: 'enum', enum: Unit, enumName: 'product_variants_unit_enum' })
  unit: Unit;

  @Column({ type: 'varchar', length: 60, nullable: true })
  color: string | null;

  @Column(quantity)
  qty: number;

  /** Sale price per unit, excl. VAT. */
  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numericTransformer })
  unitPrice: number;

  /** Purchase price per unit, excl. VAT. For the rep's margin only; never shown to the client. */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: numericTransformer })
  purchasePrice: number | null;

  /** Why the line is below the item's minimum quantity, when it is. */
  @Column({ type: 'text', nullable: true })
  belowMinReason: string | null;

  @Column({ type: 'int', default: 0 })
  position: number;

  /** Removed lines stay visible (struck through) and stop counting in totals. */
  @Column({ type: 'timestamptz', nullable: true })
  removedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  removedReason: string | null;
}

export enum DocumentType {
  PO = 'PO',
  DELIVERY_NOTE = 'DELIVERY_NOTE',
  PURCHASE_INVOICE = 'PURCHASE_INVOICE',
  SALES_INVOICE = 'SALES_INVOICE',
  OTHER = 'OTHER',
}

/** Document types the client may see in the portal (never the purchase invoice). */
export const CLIENT_VISIBLE_DOCUMENTS = [DocumentType.PO, DocumentType.DELIVERY_NOTE, DocumentType.SALES_INVOICE];

@Entity('order_documents')
export class OrderDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  order: Order;

  @Column({ type: 'uuid' })
  fileId: string;

  @ManyToOne(() => StoredFile, { onDelete: 'RESTRICT' })
  file: StoredFile;

  @Column({ type: 'enum', enum: DocumentType })
  type: DocumentType;

  /** PO number, invoice number, delivery note number… */
  @Column({ type: 'varchar', length: 80, nullable: true })
  reference: string | null;

  @Column({ type: 'uuid' })
  createdById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  removedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  removedReason: string | null;
}

/** One receipt at site (a delivery note), possibly covering several lines. */
@Entity('deliveries')
export class Delivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  order: Order;

  @Column({ type: 'date' })
  date: string;

  /** The delivery note's own number. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  reference: string | null;

  /** The uploaded delivery note, if attached. */
  @Column({ type: 'uuid', nullable: true })
  documentId: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @OneToMany(() => DeliveryLine, (l) => l.delivery)
  lines: DeliveryLine[];

  @Column({ type: 'uuid' })
  createdById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  removedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  removedReason: string | null;
}

@Entity('delivery_lines')
export class DeliveryLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  deliveryId: string;

  @ManyToOne(() => Delivery, (d) => d.lines, { onDelete: 'CASCADE' })
  delivery: Delivery;

  @Column({ type: 'uuid' })
  orderLineId: string;

  @ManyToOne(() => OrderLine, { onDelete: 'CASCADE' })
  orderLine: OrderLine;

  @Column(quantity)
  qty: number;
}

@Entity('sales_invoices')
export class SalesInvoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  order: Order;

  @Column({ type: 'varchar', length: 60 })
  number: string;

  @Column({ type: 'date' })
  date: string;

  /** Invoice total incl. VAT. */
  @Column(money)
  amount: number;

  @Column({ type: 'uuid', nullable: true })
  documentId: string | null;

  @Column({ type: 'uuid' })
  createdById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  removedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  removedReason: string | null;
}

export enum PaymentMethod {
  TRANSFER = 'TRANSFER',
  CASH = 'CASH',
}

/**
 * Money received from a client (counted once it is in the account). Cash clients must pay
 * before ordering. Cheques come in the next phase.
 */
@Entity('payments')
@Index(['clientId', 'date'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  clientId: string;

  @ManyToOne('Client', { onDelete: 'RESTRICT' })
  client: Client;

  /** Optional: the order this payment was made for. */
  @Column({ type: 'uuid', nullable: true })
  orderId: string | null;

  @Column(money)
  amount: number;

  /** Date the money reached the account. */
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'enum', enum: PaymentMethod, default: PaymentMethod.TRANSFER })
  method: PaymentMethod;

  @Column({ type: 'varchar', length: 80, nullable: true })
  reference: string | null;

  /** Transfer receipt (PDF or image). */
  @Column({ type: 'uuid', nullable: true })
  fileId: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'uuid' })
  createdById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  removedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  removedReason: string | null;
}

/** The order's history: every change, who made it and when. */
@Entity('order_events')
@Index(['orderId', 'createdAt'])
export class OrderEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  order: Order;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne('User', { onDelete: 'RESTRICT' })
  user: User;

  /** CREATED, UPDATED, STATUS, LINE_ADDED, LINE_CHANGED, LINE_REMOVED, CANCELLED, DOCUMENT_ADDED, ... */
  @Column({ type: 'varchar', length: 40 })
  type: string;

  /** What changed: { field: [before, after] } or the affected item. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  data: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

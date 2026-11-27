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
import { Competitor, LostReason } from '../market/market.entities.js';
import { numericTransformer } from '../database/transformers.js';
import { Unit } from '../products/product.entities.js';
import type { User } from '../users/user.entity.js';

export enum QuotationStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  /** The client accepted the prices: they become the client's accepted prices for later orders. */
  ACCEPTED = 'ACCEPTED',
  LOST = 'LOST',
}

@Entity('quotations')
@Index(['clientId', 'date'])
export class Quotation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Our Ref.: the client's code and its own sequence, e.g. B2B-722-00001 (NEW-00001 without a code). */
  @Column({ type: 'varchar', length: 60, unique: true })
  number: string;

  @Column({ type: 'uuid' })
  clientId: string;

  @ManyToOne('Client', { onDelete: 'RESTRICT' })
  client: Client;

  @Column({ type: 'uuid', nullable: true })
  projectId: string | null;

  @Column({ type: 'date' })
  date: string;

  /** The person it is addressed to, and how to reach them. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  attn: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  email: string | null;

  /** The client's own reference (their RFQ or inquiry number). */
  @Column({ type: 'varchar', length: 80, nullable: true })
  reference: string | null;

  @Column({ type: 'enum', enum: QuotationStatus, default: QuotationStatus.DRAFT })
  status: QuotationStatus;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 15, transformer: numericTransformer })
  vatRate: number;

  /** Terms and conditions as printed, one per line (prefilled from the standard terms). */
  @Column({ type: 'text' })
  terms: string;

  /** File name of the exported PDF; defaults to "Quotation <date>". */
  @Column({ type: 'varchar', length: 120, nullable: true })
  pdfName: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ type: 'date', nullable: true })
  acceptedAt: string | null;

  /** Payment terms the prices are given on: 0 = cash, otherwise credit days (prices differ by terms). */
  @Column({ type: 'int', default: 0 })
  creditDays: number;

  /** LOST: the day, why (fixed reasons + a note), and who took it at what terms. */
  @Column({ type: 'date', nullable: true })
  lostAt: string | null;

  @Column({ type: 'enum', enum: LostReason, enumName: 'lost_deals_reason_enum', nullable: true })
  lostReasonCode: LostReason | null;

  @Column({ type: 'text', nullable: true })
  lostReason: string | null;

  @Column({ type: 'uuid', nullable: true })
  competitorId: string | null;

  @ManyToOne(() => Competitor, { onDelete: 'SET NULL', nullable: true })
  competitor: Competitor | null;

  @Column({ type: 'int', nullable: true })
  competitorCreditDays: number | null;

  @Column({ type: 'uuid' })
  createdById: string;

  @ManyToOne('User', { onDelete: 'RESTRICT' })
  createdBy: User;

  @OneToMany(() => QuotationLine, (l) => l.quotation)
  lines: QuotationLine[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('quotation_lines')
export class QuotationLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  quotationId: string;

  @ManyToOne(() => Quotation, (q) => q.lines, { onDelete: 'CASCADE' })
  quotation: Quotation;

  @Column({ type: 'int', default: 0 })
  position: number;

  /** What the client reads, e.g. "Rajhi 12-32" or "يمامة تشطيب". */
  @Column({ type: 'varchar', length: 200 })
  name: string;

  /**
   * The catalogue items this line prices (one name can cover several, e.g. every rebar diameter
   * from 12 to 32 mm). Once accepted, each of them gets this price as the client's accepted price.
   */
  @Column({ type: 'uuid', array: true, default: () => "'{}'" })
  variantIds: string[];

  @Column({ type: 'enum', enum: Unit, enumName: 'product_variants_unit_enum' })
  unit: Unit;

  @Column({ type: 'numeric', precision: 12, scale: 3, transformer: numericTransformer })
  qty: number;

  /** Excl. VAT */
  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numericTransformer })
  unitPrice: number;

  /** LOST: the competitor's price for this line, when known (excl. VAT). */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: numericTransformer })
  competitorPrice: number | null;
}

/** The quotation's history: created, edited, sent, accepted, lost (with the details), reopened. */
@Entity('quotation_events')
@Index(['quotationId', 'createdAt'])
export class QuotationEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  quotationId: string;

  @ManyToOne(() => Quotation, { onDelete: 'CASCADE' })
  quotation: Quotation;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne('User', { onDelete: 'RESTRICT' })
  user: User;

  @Column({ type: 'varchar', length: 40 })
  type: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  data: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

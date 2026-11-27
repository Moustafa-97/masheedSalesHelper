import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Client } from '../clients/client.entity.js';
import { numericTransformer } from '../database/transformers.js';
import { Unit } from '../products/product.entities.js';
import type { Quotation } from '../quotations/quotation.entities.js';
import type { User } from '../users/user.entity.js';

/**
 * A competitor or a brand we meet in the market. One list, added to as we go, so the analysis
 * doesn't split the same company under two spellings ("Rajhi" / "الراجحي"): admins can merge them.
 */
@Entity('competitors')
export class Competitor {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  /** Lower-cased, trimmed, single-spaced name: two entries that only differ in spelling case clash. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 120 })
  key: string;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

export const competitorKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

export enum LostReason {
  PRICE = 'PRICE',
  PAYMENT_TERMS = 'PAYMENT_TERMS',
  DELIVERY = 'DELIVERY',
  AVAILABILITY = 'AVAILABILITY',
  RELATIONSHIP = 'RELATIONSHIP',
  OTHER = 'OTHER',
}

/** A deal lost before any quotation was written (lost quotations are read from the quotations). */
@Entity('lost_deals')
@Index(['date'])
export class LostDeal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'date' })
  date: string;

  /** A client from the system, or just a name typed in. */
  @Column({ type: 'uuid', nullable: true })
  clientId: string | null;

  @ManyToOne('Client', { onDelete: 'SET NULL', nullable: true })
  client: Client | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  clientName: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  zone: string | null;

  @Column({ type: 'enum', enum: LostReason })
  reason: LostReason;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'uuid', nullable: true })
  competitorId: string | null;

  @ManyToOne(() => Competitor, { onDelete: 'SET NULL', nullable: true })
  competitor: Competitor | null;

  /** Our payment terms on the prices we offered: 0 = cash, otherwise credit days. */
  @Column({ type: 'int', default: 0 })
  creditDays: number;

  /** The competitor's payment terms on their prices (same meaning). */
  @Column({ type: 'int', default: 0 })
  competitorCreditDays: number;

  @Column({ type: 'uuid' })
  createdById: string;

  @ManyToOne('User', { onDelete: 'RESTRICT' })
  createdBy: User;

  @OneToMany(() => LostDealLine, (l) => l.lostDeal)
  lines: LostDealLine[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('lost_deal_lines')
export class LostDealLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  lostDealId: string;

  @ManyToOne(() => LostDeal, (d) => d.lines, { onDelete: 'CASCADE' })
  lostDeal: LostDeal;

  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'uuid', array: true, default: () => "'{}'" })
  variantIds: string[];

  @Column({ type: 'enum', enum: Unit, enumName: 'product_variants_unit_enum' })
  unit: Unit;

  @Column({ type: 'numeric', precision: 12, scale: 3, transformer: numericTransformer })
  qty: number;

  /** Excl. VAT */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: numericTransformer })
  ourPrice: number | null;

  /** Excl. VAT */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: numericTransformer })
  competitorPrice: number | null;
}

export enum PriceSource {
  CLIENT = 'CLIENT',
  SUPPLIER = 'SUPPLIER',
  MARKET = 'MARKET',
  /** Written automatically from a lost quotation or a lost deal. */
  LOST_QUOTATION = 'LOST_QUOTATION',
  LOST_DEAL = 'LOST_DEAL',
}

/** A competitor's price heard in the market. Always excl. VAT, always with its payment terms. */
@Entity('market_prices')
@Index(['date'])
export class MarketPrice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'uuid', array: true, default: () => "'{}'" })
  variantIds: string[];

  @Column({ type: 'enum', enum: Unit, enumName: 'product_variants_unit_enum' })
  unit: Unit;

  /** Excl. VAT */
  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numericTransformer })
  price: number;

  /** 0 = cash; otherwise the credit days the price is given on (2750 cash ≠ 2830 on 45 days). */
  @Column({ type: 'int', default: 0 })
  creditDays: number;

  @Column({ type: 'uuid', nullable: true })
  competitorId: string | null;

  @ManyToOne(() => Competitor, { onDelete: 'SET NULL', nullable: true })
  competitor: Competitor | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  zone: string | null;

  @Column({ type: 'enum', enum: PriceSource })
  source: PriceSource;

  @Column({ type: 'uuid', nullable: true })
  quotationId: string | null;

  @ManyToOne('Quotation', { onDelete: 'CASCADE', nullable: true })
  quotation: Quotation | null;

  @Column({ type: 'uuid', nullable: true })
  lostDealId: string | null;

  @ManyToOne(() => LostDeal, { onDelete: 'CASCADE', nullable: true })
  lostDeal: LostDeal | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'uuid' })
  createdById: string;

  @ManyToOne('User', { onDelete: 'RESTRICT' })
  createdBy: User;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

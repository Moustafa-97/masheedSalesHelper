import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '../database/transformers.js';

export enum Unit {
  TON = 'TON',
  BAG = 'BAG',
  M3 = 'M3',
  PIECE = 'PIECE',
  KG = 'KG',
  METER = 'METER',
  GALLON = 'GALLON',
  TRAILER = 'TRAILER',
}

@Entity('brands')
export class Brand {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  nameEn: string | null;
}

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** e.g. "حديد تسليح", "أسمنت تشطيب" */
  @Column({ unique: true })
  name: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  nameEn: string | null;

  /** ERP category, e.g. "Steel", "Grey Cement", "Blocks & Bricks" */
  @Column({ type: 'varchar', length: 40 })
  category: string;

  @OneToMany(() => ProductVariant, (v) => v.product)
  variants: ProductVariant[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

/** What is actually sold: a product of one brand (and size), with its unit and minimum order quantity. */
@Entity('product_variants')
@Index(['productId', 'brandId', 'spec'], { unique: true })
export class ProductVariant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, (p) => p.variants, { onDelete: 'CASCADE' })
  product: Product;

  @Column({ type: 'uuid', nullable: true })
  brandId: string | null;

  @ManyToOne(() => Brand, { onDelete: 'RESTRICT', nullable: true })
  brand: Brand | null;

  /** Size or grade, e.g. "16 مم". Empty string when not applicable. */
  @Column({ type: 'varchar', length: 60, default: '' })
  spec: string;

  @Column({ type: 'enum', enum: Unit })
  unit: Unit;

  /** Minimum order quantity in `unit`, set by the admin. Null = not set yet. */
  @Column({
    type: 'numeric',
    precision: 12,
    scale: 3,
    nullable: true,
    transformer: numericTransformer,
  })
  minQty: number | null;

  /** Full item name in Masheed's ERP export; the key for re-imports. Null for items added by hand. */
  @Column({ type: 'varchar', length: 255, nullable: true, unique: true })
  erpName: string | null;

  /** Colours or colour codes available (from the ERP export), chosen per order line. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  colors: string[];

  @OneToMany(() => VariantZone, (z) => z.variant)
  zones: VariantZone[];

  @Column({ type: 'varchar', length: 120, nullable: true })
  supplierName: string | null;

  @Column({ default: true })
  isActive: boolean;
}

/**
 * Where a variant is sold and in which loads, from the ERP export:
 * one row per region and load, e.g. Riyadh / "580 Bags" / 580.
 */
@Entity('variant_zones')
@Index(['variantId', 'zone', 'label'], { unique: true })
export class VariantZone {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  variantId: string;

  @ManyToOne(() => ProductVariant, (v) => v.zones, { onDelete: 'CASCADE' })
  variant: ProductVariant;

  /** ERP zone, e.g. "Riyadh", "Dammam" */
  @Column({ type: 'varchar', length: 40 })
  zone: string;

  /** The ERP unit text as exported, e.g. "580 Bags", "600 Pallet", "Ton" */
  @Column({ type: 'varchar', length: 40 })
  label: string;

  /** Quantity in one load (580 for "580 Bags"); null for plain units like "Ton" */
  @Column({ type: 'numeric', precision: 12, scale: 3, nullable: true, transformer: numericTransformer })
  loadQty: number | null;
}

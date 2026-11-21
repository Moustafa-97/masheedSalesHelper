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

  /** e.g. STEEL, CEMENT, SAND, BLOCK */
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

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 3,
    default: 0,
    transformer: numericTransformer,
  })
  minQty: number;

  @Column({ type: 'varchar', length: 120, nullable: true })
  supplierName: string | null;

  @Column({ default: true })
  isActive: boolean;
}

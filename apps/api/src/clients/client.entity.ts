import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { numericTransformer } from '../database/transformers.js';
import type { User } from '../users/user.entity.js';

export enum ClientStatus {
  /** Has a credit account and can receive orders. */
  ACTIVE = 'ACTIVE',
  /** Known from a quotation or a lost deal, no account yet. */
  PROSPECT = 'PROSPECT',
  INACTIVE = 'INACTIVE',
}

@Entity('clients')
@Index(['repId', 'name'])
export class Client {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The client's code in the company ERP, if any. */
  @Column({ type: 'varchar', length: 40, unique: true, nullable: true })
  code: string | null;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: ClientStatus, default: ClientStatus.ACTIVE })
  status: ClientStatus;

  @Column({ type: 'uuid' })
  repId: string;

  @ManyToOne('User', { onDelete: 'RESTRICT' })
  rep: User;

  @Column({ type: 'varchar', length: 80, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  crNumber: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  vatNumber: string | null;

  /** Credit period added to the invoice date to get the due date (30/45/60). */
  @Column({ type: 'int', default: 0 })
  paymentTermsDays: number;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  creditLimit: number;

  /** Balance carried over from before the system started (incl. VAT). */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  openingBalance: number;

  @Column({ type: 'varchar', length: 120, nullable: true })
  purchasingName: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  purchasingPhone: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  purchasingEmail: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

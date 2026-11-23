import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Client } from '../clients/client.entity.js';

export enum Role {
  ADMIN = 'ADMIN',
  REP = 'REP',
  CLIENT = 'CLIENT',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  /** Sign-in identifier (email or phone, at least one of them). */
  @Column({ type: 'varchar', length: 255, unique: true, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 32, unique: true, nullable: true })
  phone: string | null;

  @Column({ select: false })
  passwordHash: string;

  @Column({ type: 'enum', enum: Role, default: Role.REP })
  role: Role;

  /** Shown on quotations, e.g. "Technical Sales Engineer". */
  @Column({ type: 'varchar', length: 120, nullable: true })
  jobTitle: string | null;

  /** For CLIENT users: the client account they belong to. */
  @Column({ type: 'uuid', nullable: true })
  clientId: string | null;

  @ManyToOne('Client', { onDelete: 'CASCADE', nullable: true })
  client: Client | null;

  @Column({ type: 'varchar', length: 2, default: 'ar' })
  locale: 'ar' | 'en';

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

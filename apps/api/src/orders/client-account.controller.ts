import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { CurrentUser, Roles } from '../common/auth.decorators.js';
import { Role, User } from '../users/user.entity.js';
import { isUniqueViolation } from '../users/users.module.js';
import { AccountService } from './account.service.js';
import { ClientProject, Order, Payment, PaymentMethod, StoredFile } from './order.entities.js';
import { AddPaymentDto, ProjectDto, ReasonDto, UpdateProjectDto } from './orders.dto.js';

/** A client's projects (sites), payments and credit account. */
@Controller('clients/:clientId')
@Roles(Role.ADMIN, Role.REP)
export class ClientAccountController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly accounts: AccountService,
  ) {}

  @Get('account')
  async account(@CurrentUser() user: User, @Param('clientId', ParseUUIDPipe) clientId: string) {
    return this.accounts.account(await this.accounts.clientFor(user, clientId));
  }

  /* ---------- Projects ---------- */

  @Get('projects')
  async projects(@CurrentUser() user: User, @Param('clientId', ParseUUIDPipe) clientId: string) {
    await this.accounts.clientFor(user, clientId);
    return this.dataSource.getRepository(ClientProject).find({
      where: { clientId },
      order: { isActive: 'DESC', name: 'ASC' },
    });
  }

  @Post('projects')
  async addProject(
    @CurrentUser() user: User,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: ProjectDto,
  ) {
    await this.accounts.clientFor(user, clientId);
    try {
      return await this.dataSource.getRepository(ClientProject).save({
        clientId,
        name: dto.name.trim(),
        mapsUrl: dto.mapsUrl?.trim() || null,
        contacts: dto.contacts?.trim() || null,
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('This client already has a project with this name');
      throw e;
    }
  }

  @Patch('projects/:projectId')
  async updateProject(
    @CurrentUser() user: User,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    await this.accounts.clientFor(user, clientId);
    const repo = this.dataSource.getRepository(ClientProject);
    const changes = {
      ...dto,
      ...(dto.name !== undefined && { name: dto.name.trim() }),
      ...(dto.mapsUrl !== undefined && { mapsUrl: dto.mapsUrl?.trim() || null }),
      ...(dto.contacts !== undefined && { contacts: dto.contacts?.trim() || null }),
    };
    try {
      const result = await repo.update({ id: projectId, clientId }, changes);
      if (!result.affected) throw new NotFoundException('Project not found');
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('This client already has a project with this name');
      throw e;
    }
    return repo.findOneByOrFail({ id: projectId });
  }

  /* ---------- Payments ---------- */

  @Get('payments')
  async payments(@CurrentUser() user: User, @Param('clientId', ParseUUIDPipe) clientId: string) {
    await this.accounts.clientFor(user, clientId);
    const rows = await this.dataSource.getRepository(Payment).find({
      where: { clientId },
      order: { date: 'DESC', createdAt: 'DESC' },
    });
    const files = rows.some((p) => p.fileId)
      ? await this.dataSource.getRepository(StoredFile).findBy(
          rows.filter((p) => p.fileId).map((p) => ({ id: p.fileId! })),
        )
      : [];
    const byId = new Map(files.map((f) => [f.id, f]));
    return rows.map((p) => ({ ...p, file: p.fileId ? (byId.get(p.fileId) ?? null) : null }));
  }

  @Post('payments')
  async addPayment(
    @CurrentUser() user: User,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: AddPaymentDto,
  ) {
    await this.accounts.clientFor(user, clientId);
    if (dto.orderId && !(await this.dataSource.getRepository(Order).existsBy({ id: dto.orderId, clientId }))) {
      throw new BadRequestException("The order isn't this client's");
    }
    if (dto.fileId) {
      const file = await this.dataSource.getRepository(StoredFile).findOneBy({ id: dto.fileId });
      if (!file || (user.role !== Role.ADMIN && file.uploadedById !== user.id)) {
        throw new BadRequestException('File not found');
      }
    }
    return this.dataSource.getRepository(Payment).save({
      clientId,
      orderId: dto.orderId ?? null,
      amount: dto.amount,
      date: dto.date,
      method: dto.method ?? PaymentMethod.TRANSFER,
      reference: dto.reference?.trim() || null,
      fileId: dto.fileId ?? null,
      notes: dto.notes?.trim() || null,
      createdById: user.id,
    });
  }

  /** Payments are never deleted: a removed one stays listed with its reason and stops counting. */
  @Delete('payments/:paymentId')
  async removePayment(
    @CurrentUser() user: User,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: ReasonDto,
  ) {
    await this.accounts.clientFor(user, clientId);
    const result = await this.dataSource
      .getRepository(Payment)
      .update({ id: paymentId, clientId, removedAt: IsNull() }, { removedAt: new Date(), removedReason: dto.reason });
    if (!result.affected) throw new NotFoundException('Payment not found');
    return { ok: true };
  }
}

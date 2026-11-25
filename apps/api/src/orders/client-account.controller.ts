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
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import { CurrentUser, Roles } from '../common/auth.decorators.js';
import { Role, User } from '../users/user.entity.js';
import { isUniqueViolation } from '../users/users.module.js';
import { AccountService, CHEQUE_APPROVAL_UNTIL_SQL, LC_ATTENTION_DAYS, todayIso } from './account.service.js';
import { ClientProject, Order, Payment, PaymentMethod, PaymentStatus, StoredFile } from './order.entities.js';
import {
  AddPaymentDto,
  CreditApprovalDto,
  PaymentStatusDto,
  ProjectDto,
  ReasonDto,
  StatementQuery,
  UpdateProjectDto,
} from './orders.dto.js';

export const METHOD_AR: Record<string, string> = {
  TRANSFER: 'تحويل',
  CASH: 'نقدي',
  CHEQUE: 'شيك',
  LC: 'اعتماد مستندي LC',
  EPN: 'سند لأمر إلكتروني',
  LG: 'ضمان بنكي LG',
  NO_GUARANTEE: 'موافقة بدون ضمان',
};


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

  /** Aging (oldest debts first), overdue stop, average collection days and guarantee coverage. */
  @Get('credit')
  async credit(@CurrentUser() user: User, @Param('clientId', ParseUUIDPipe) clientId: string) {
    const client = await this.accounts.clientFor(user, clientId);
    const [account, profile] = await Promise.all([this.accounts.account(client), this.accounts.profile(client)]);
    return { account, profile };
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
    const { entities, raw } = await this.dataSource
      .getRepository(Payment)
      .createQueryBuilder('p')
      .addSelect(`to_char(${CHEQUE_APPROVAL_UNTIL_SQL.replaceAll('"dueDate"', 'p."dueDate"')}, 'YYYY-MM-DD')`, 'approval_until')
      .where('p.clientId = :clientId', { clientId })
      .orderBy('p.date', 'DESC')
      .addOrderBy('p.createdAt', 'DESC')
      .getRawAndEntities();
    const today = todayIso();
    const ids = entities.flatMap((p) => [p.fileId, p.approvalFileId]).filter((x): x is string => !!x);
    const files = ids.length ? await this.dataSource.getRepository(StoredFile).findBy(ids.map((id) => ({ id }))) : [];
    const byId = new Map(files.map((f) => [f.id, f]));
    return entities.map((p, i) => {
      const until = p.method === PaymentMethod.CHEQUE && p.creditApprovedAmount ? (raw[i].approval_until as string) : null;
      const lcSince = p.dueDate ?? p.date;
      return {
        ...p,
        approvalUntil: until,
        approvalValid: !!until && p.status === PaymentStatus.PENDING && until >= today,
        /** A payment LC counts in full while being collected; past 20 days it needs attention. */
        lcAttention:
          p.method === PaymentMethod.LC &&
          p.status === PaymentStatus.PENDING &&
          Date.parse(today) - Date.parse(lcSince) > LC_ATTENTION_DAYS * 86_400_000,
        file: p.fileId ? (byId.get(p.fileId) ?? null) : null,
        approvalFile: p.approvalFileId ? (byId.get(p.approvalFileId) ?? null) : null,
      };
    });
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
    await this.ownFile(user, dto.fileId);
    const method = dto.method ?? PaymentMethod.TRANSFER;
    const deferred = method === PaymentMethod.CHEQUE || method === PaymentMethod.LC;
    if (deferred && !dto.dueDate) throw new BadRequestException('A cheque or LC needs its date');
    return this.dataSource.getRepository(Payment).save({
      clientId,
      orderId: dto.orderId ?? null,
      amount: dto.amount,
      date: dto.date,
      method,
      // A cheque or LC counts as paid only once the money is in the account.
      status: deferred ? PaymentStatus.PENDING : PaymentStatus.RECEIVED,
      collectedDate: deferred ? null : dto.date,
      dueDate: dto.dueDate ?? null,
      bank: dto.bank?.trim() || null,
      reference: dto.reference?.trim() || null,
      fileId: dto.fileId ?? null,
      notes: dto.notes?.trim() || null,
      createdById: user.id,
    });
  }

  /** A cheque or LC is collected (RECEIVED) or bounces; a bounced one can be presented again (PENDING). */
  @Put('payments/:paymentId/status')
  async paymentStatus(
    @CurrentUser() user: User,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: PaymentStatusDto,
  ) {
    await this.accounts.clientFor(user, clientId);
    const repo = this.dataSource.getRepository(Payment);
    const payment = await repo.findOneBy({ id: paymentId, clientId });
    if (!payment || payment.removedAt) throw new NotFoundException('Payment not found');
    if (payment.method !== PaymentMethod.CHEQUE && payment.method !== PaymentMethod.LC) {
      throw new BadRequestException('Only cheques and LCs change status');
    }
    if (dto.status === PaymentStatus.RETURNED) throw new BadRequestException('Return a guarantee from the guarantees section');
    const notes =
      dto.status === PaymentStatus.BOUNCED && dto.reason
        ? [payment.notes, `مرتجع: ${dto.reason}`].filter(Boolean).join('\n')
        : payment.notes;
    await repo.update(
      { id: paymentId },
      {
        status: dto.status,
        collectedDate: dto.status === PaymentStatus.RECEIVED ? (dto.collectedDate ?? todayIso()) : null,
        notes,
      },
    );
    return repo.findOneByOrFail({ id: paymentId });
  }

  /**
   * Management approval to count a collection cheque towards the available credit until it clears
   * (100% unless stated). Payment LCs count in full without approval.
   */
  @Put('payments/:paymentId/approval')
  async approval(
    @CurrentUser() user: User,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: CreditApprovalDto,
  ) {
    await this.accounts.clientFor(user, clientId);
    const repo = this.dataSource.getRepository(Payment);
    const payment = await repo.findOneBy({ id: paymentId, clientId });
    if (!payment || payment.removedAt) throw new NotFoundException('Payment not found');
    if (payment.method !== PaymentMethod.CHEQUE) throw new BadRequestException('Only a cheque needs a credit approval');
    if (payment.status !== PaymentStatus.PENDING) throw new BadRequestException('Only a cheque still being collected');
    checkApproval(dto, payment.amount);
    await this.ownFile(user, dto.fileId);
    await repo.update({ id: paymentId }, approvalFields(dto, payment.approvalFileId));
    return repo.findOneByOrFail({ id: paymentId });
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
    const repo = this.dataSource.getRepository(Payment);
    const payment = await repo.findOneBy({ id: paymentId, clientId });
    if (!payment || payment.removedAt) throw new NotFoundException('Payment not found');
    await repo.update({ id: paymentId }, { removedAt: new Date(), removedReason: dto.reason });
    return { ok: true };
  }

  /* ---------- Statement of account ---------- */

  @Get('statement')
  async statement(
    @CurrentUser() user: User,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query() q: StatementQuery,
  ) {
    const client = await this.accounts.clientFor(user, clientId);
    return this.accounts.statement(client, q.from ?? null, q.to ?? null);
  }

  @Get('statement/export')
  async statementExport(
    @CurrentUser() user: User,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query() q: StatementQuery,
  ) {
    const client = await this.accounts.clientFor(user, clientId);
    const st = await this.accounts.statement(client, q.from ?? null, q.to ?? null);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('كشف حساب', { views: [{ rightToLeft: true }] });
    ws.columns = [12, 18, 18, 30, 16, 16, 16].map((width) => ({ width }));
    ws.addRow([`كشف حساب: ${st.client.name}${st.client.code ? ` (${st.client.code})` : ''}`]).font = { bold: true, size: 14 };
    ws.addRow([`الفترة: ${st.from ?? 'من البداية'} — ${st.to ?? todayIso()}`]);
    ws.addRow([]);
    const head = ws.addRow(['التاريخ', 'النوع', 'المرجع', 'البيان', 'مدين', 'دائن', 'الرصيد']);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B3D33' } };
    ws.addRow([st.from ?? '', 'رصيد أول المدة', '', '', null, null, st.opening]).font = { italic: true };
    for (const e of st.entries) {
      ws.addRow([
        e.date,
        e.type === 'ORDER' ? 'طلبية' : 'دفعة',
        e.reference,
        e.type === 'PAYMENT' ? e.description.split(' · ').map((x) => METHOD_AR[x] ?? x).join(' · ') : e.description,
        e.debit || null,
        e.credit || null,
        e.balance,
      ]);
    }
    ws.addRow(['', 'الإجمالي', '', '', st.totalDebit, st.totalCredit, st.closing]).font = { bold: true };
    const held = (title: string, list: typeof st.pending, dateLabel: string) => {
      if (!list.length) return;
      ws.addRow([]);
      ws.addRow([title]).font = { bold: true };
      for (const p of list) {
        ws.addRow([p.date ?? '', METHOD_AR[p.method] ?? p.method, p.reference ?? '', `${p.bank ?? ''}${p.dueDate ? ` · ${dateLabel} ${p.dueDate}` : ''}`, null, p.amount, null]);
      }
    };
    held('شيكات واعتمادات تحت التحصيل (مش محسوبة في الرصيد)', st.pending, 'استحقاق');
    held('الضمانات (مش محسوبة في الرصيد)', st.guarantees, 'انتهاء');
    for (const col of [5, 6, 7]) ws.getColumn(col).numFmt = '#,##0.00';
    const name = `statement-${(client.code ?? client.name).replace(/[^\w\u0600-\u06ff-]+/g, '_')}-${todayIso()}.xlsx`;
    return new StreamableFile(Buffer.from(await wb.xlsx.writeBuffer()), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="statement.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
    });
  }

  private async ownFile(user: User, fileId: string | null | undefined) {
    if (!fileId) return;
    const file = await this.dataSource.getRepository(StoredFile).findOneBy({ id: fileId });
    if (!file || (user.role !== Role.ADMIN && file.uploadedById !== user.id)) throw new BadRequestException('File not found');
  }
}

/** An approval needs who approved it and can't exceed what is held. */
export function checkApproval(dto: CreditApprovalDto, max: number | null) {
  if (max !== null && dto.amount > max) throw new BadRequestException("The approved amount can't exceed the cheque");
  if (dto.amount > 0 && !dto.approvedBy?.trim()) throw new BadRequestException('Who approved it?');
}

export function approvalFields(dto: CreditApprovalDto, currentFileId: string | null) {
  const withdraw = dto.amount === 0;
  return {
    creditApprovedAmount: withdraw ? null : dto.amount,
    approvedBy: withdraw ? null : dto.approvedBy!.trim(),
    approvedAt: withdraw ? null : (dto.approvedAt ?? todayIso()),
    approvalFileId: withdraw ? null : (dto.fileId ?? currentFileId),
  };
}

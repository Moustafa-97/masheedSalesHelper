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
import ExcelJS from 'exceljs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { CurrentUser, Roles } from '../common/auth.decorators.js';
import { Role, User } from '../users/user.entity.js';
import { isUniqueViolation } from '../users/users.module.js';
import { AccountService, buildStatement } from './account.service.js';
import { ClientProject, Order, Payment, PaymentMethod, PaymentStatus, StoredFile } from './order.entities.js';
import {
  AddPaymentDto,
  PaymentStatusDto,
  ProjectDto,
  ReasonDto,
  StatementQuery,
  UpdateProjectDto,
} from './orders.dto.js';

const METHOD_AR: Record<string, string> = { TRANSFER: 'تحويل', CASH: 'نقدي', CHEQUE: 'شيك', LC: 'اعتماد مستندي LC' };
const today = () => new Date().toISOString().slice(0, 10);

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
    const method = dto.method ?? PaymentMethod.TRANSFER;
    const deferred = method === PaymentMethod.CHEQUE || method === PaymentMethod.LC;
    if (deferred && !dto.dueDate) throw new BadRequestException('A cheque or LC needs its due date');
    return this.dataSource.getRepository(Payment).save({
      clientId,
      orderId: dto.orderId ?? null,
      amount: dto.amount,
      date: dto.date,
      method,
      // A cheque or LC counts only once the money is in the account.
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

  /** A cheque or LC is collected (RECEIVED) or bounces; a bounced cheque can be presented again (PENDING). */
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
    const notes = dto.status === PaymentStatus.BOUNCED && dto.reason
      ? [payment.notes, `مرتجع: ${dto.reason}`].filter(Boolean).join('\n')
      : payment.notes;
    await repo.update(
      { id: paymentId },
      {
        status: dto.status,
        collectedDate: dto.status === PaymentStatus.RECEIVED ? (dto.collectedDate ?? today()) : null,
        notes,
      },
    );
    return repo.findOneByOrFail({ id: paymentId });
  }

  /* ---------- Statement of account ---------- */

  @Get('statement')
  async statement(
    @CurrentUser() user: User,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query() q: StatementQuery,
  ) {
    const client = await this.accounts.clientFor(user, clientId);
    return buildStatement(this.dataSource.manager, client, q.from ?? null, q.to ?? null);
  }

  @Get('statement/export')
  async statementExport(
    @CurrentUser() user: User,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query() q: StatementQuery,
  ) {
    const client = await this.accounts.clientFor(user, clientId);
    const st = await buildStatement(this.dataSource.manager, client, q.from ?? null, q.to ?? null);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('كشف حساب', { views: [{ rightToLeft: true }] });
    ws.columns = [
      { key: 'date', width: 12 },
      { key: 'kind', width: 14 },
      { key: 'ref', width: 18 },
      { key: 'desc', width: 30 },
      { key: 'debit', width: 16 },
      { key: 'credit', width: 16 },
      { key: 'balance', width: 16 },
    ];
    const money = '#,##0.00';
    ws.addRow([`كشف حساب: ${st.client.name}${st.client.code ? ` (${st.client.code})` : ''}`]).font = { bold: true, size: 14 };
    ws.addRow([`الفترة: ${st.from ?? 'من البداية'} — ${st.to ?? today()}`]);
    ws.addRow([]);
    const head = ws.addRow(['التاريخ', 'النوع', 'المرجع', 'البيان', 'مدين', 'دائن', 'الرصيد']);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B3D33' } };
    ws.addRow([st.from ?? '', 'رصيد افتتاحي', '', '', null, null, st.opening]).font = { italic: true };
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
    const total = ws.addRow(['', 'الإجمالي', '', '', st.totalDebit, st.totalCredit, st.closing]);
    total.font = { bold: true };
    if (st.pending.length) {
      ws.addRow([]);
      ws.addRow(['شيكات واعتمادات تحت التحصيل (مش محسوبة في الرصيد)']).font = { bold: true };
      for (const p of st.pending) {
        ws.addRow([p.date, METHOD_AR[p.method] ?? p.method, p.reference ?? '', `${p.bank ?? ''} · استحقاق ${p.dueDate ?? ''}`, null, p.amount, null]);
      }
    }
    for (const col of [5, 6, 7]) ws.getColumn(col).numFmt = money;
    const name = `statement-${(client.code ?? client.name).replace(/[^\w\u0600-\u06ff-]+/g, '_')}-${today()}.xlsx`;
    return new StreamableFile(Buffer.from(await wb.xlsx.writeBuffer()), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="statement.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
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

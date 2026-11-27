import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { CurrentUser, Roles } from '../common/auth.decorators.js';
import { Role, User } from '../users/user.entity.js';
import { AccountService, todayIso } from './account.service.js';
import { approvalFields, checkApproval } from './client-account.controller.js';
import {
  ClientGuarantee,
  GuaranteeStatus,
  GuaranteeType,
  Payment,
  PaymentMethod,
  PaymentStatus,
  StoredFile,
} from './order.entities.js';
import {
  ConvertGuaranteeDto,
  CreditApprovalDto,
  GuaranteeDto,
  GuaranteeStatusDto,
  ReasonDto,
  ReplaceGuaranteeDto,
} from './orders.dto.js';

/** Cheques and LCs held as guarantees raise the available credit by their approved amount. */
const CREDIT_TYPES = [GuaranteeType.CHEQUE, GuaranteeType.LC];

const STATUS_AR: Partial<Record<GuaranteeStatus, string>> = {
  RETURNED: 'اترجع للعميل',
  BOUNCED: 'مرتجع',
  EXPIRED: 'انتهى',
};

/** The client's guarantees: promissory notes, LCs, LGs, cheques, or credit approved without a guarantee. */
@Controller('clients/:clientId/guarantees')
@Roles(Role.ADMIN, Role.REP)
export class GuaranteesController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly accounts: AccountService,
  ) {}

  private get repo() {
    return this.dataSource.getRepository(ClientGuarantee);
  }

  @Get()
  async list(@CurrentUser() user: User, @Param('clientId', ParseUUIDPipe) clientId: string) {
    await this.accounts.clientFor(user, clientId);
    const rows = await this.repo.find({ where: { clientId }, order: { createdAt: 'DESC' } });
    const ids = rows.flatMap((g) => [g.fileId, g.approvalFileId]).filter((x): x is string => !!x);
    const files = ids.length ? await this.dataSource.getRepository(StoredFile).findBy({ id: In(ids) }) : [];
    const byId = new Map(files.map((f) => [f.id, f]));
    return rows.map((g) => ({
      ...g,
      file: g.fileId ? (byId.get(g.fileId) ?? null) : null,
      approvalFile: g.approvalFileId ? (byId.get(g.approvalFileId) ?? null) : null,
      awaitingReplacement: g.status === GuaranteeStatus.BOUNCED && !g.paymentId && !g.replacedByGuaranteeId && !g.removedAt,
    }));
  }

  @Post()
  async add(@CurrentUser() user: User, @Param('clientId', ParseUUIDPipe) clientId: string, @Body() dto: GuaranteeDto) {
    await this.accounts.clientFor(user, clientId);
    const none = dto.type === GuaranteeType.NO_GUARANTEE;
    if (!none && !dto.amount) throw new BadRequestException('Enter the guarantee amount');
    if (none && !dto.approvedBy?.trim()) throw new BadRequestException('Who approved credit without a guarantee?');
    const credit = CREDIT_TYPES.includes(dto.type) ? (dto.creditApprovedAmount ?? null) : null;
    if (credit) checkApproval({ amount: credit, approvedBy: dto.approvedBy }, dto.amount ?? null);
    await this.ownFile(user, dto.fileId);
    await this.ownFile(user, dto.approvalFileId);

    let replaces: ClientGuarantee | null = null;
    if (dto.replacesGuaranteeId) {
      replaces = await this.repo.findOneBy({ id: dto.replacesGuaranteeId, clientId, status: GuaranteeStatus.BOUNCED });
      if (!replaces) throw new BadRequestException('Not a bounced guarantee of this client');
    }
    const approved = credit || none;
    const saved = await this.repo.save({
      clientId,
      type: dto.type,
      amount: dto.amount ?? null,
      reference: dto.reference?.trim() || null,
      issuer: dto.issuer?.trim() || null,
      date: dto.date ?? null,
      expiryDate: dto.expiryDate ?? null,
      fileId: dto.fileId ?? null,
      creditApprovedAmount: credit,
      approvedBy: approved ? dto.approvedBy!.trim() : null,
      approvedAt: approved ? todayIso() : null,
      approvalFileId: approved ? (dto.approvalFileId ?? null) : null,
      notes: dto.notes?.trim() || null,
      createdById: user.id,
    });
    if (replaces) await this.repo.update({ id: replaces.id }, { replacedByGuaranteeId: saved.id });
    return saved;
  }

  /** Approve (or change, or withdraw with 0) the credit a guarantee cheque / LC adds. */
  @Put(':id/approval')
  async approval(
    @CurrentUser() user: User,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreditApprovalDto,
  ) {
    const g = await this.active(user, clientId, id);
    if (!CREDIT_TYPES.includes(g.type)) throw new BadRequestException('Only a cheque or LC adds credit');
    checkApproval(dto, g.amount);
    await this.ownFile(user, dto.fileId);
    await this.repo.update({ id }, approvalFields(dto, g.approvalFileId));
    return this.repo.findOneByOrFail({ id });
  }

  /** Returned to the client, bounced (cheques: then needs a replacement), or expired. */
  @Put(':id/status')
  async status(
    @CurrentUser() user: User,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GuaranteeStatusDto,
  ) {
    const g = await this.active(user, clientId, id);
    if (dto.status === GuaranteeStatus.ACTIVE) return g;
    if (dto.status === GuaranteeStatus.BOUNCED && g.type !== GuaranteeType.CHEQUE) {
      throw new BadRequestException('Only a cheque bounces');
    }
    const label = STATUS_AR[dto.status];
    await this.repo.update(
      { id },
      { status: dto.status, notes: dto.reason ? [g.notes, `${label}: ${dto.reason}`].filter(Boolean).join('\n') : g.notes },
    );
    return this.repo.findOneByOrFail({ id });
  }

  /**
   * Present a guarantee cheque / LC for collection: it becomes a collection payment (carrying its
   * approval), dated the day it is deposited.
   */
  @Post(':id/convert')
  async convert(
    @CurrentUser() user: User,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvertGuaranteeDto,
  ) {
    const g = await this.active(user, clientId, id);
    if (!CREDIT_TYPES.includes(g.type)) throw new BadRequestException('Only a cheque or LC is presented for collection');
    const date = dto.date ?? todayIso();
    return this.dataSource.transaction(async (m) => {
      const payment = await m.save(
        m.create(Payment, {
          clientId,
          amount: g.amount!,
          date,
          dueDate: date,
          method: g.type === GuaranteeType.CHEQUE ? PaymentMethod.CHEQUE : PaymentMethod.LC,
          status: PaymentStatus.PENDING,
          collectedDate: null,
          reference: g.reference,
          bank: g.issuer,
          fileId: g.fileId,
          creditApprovedAmount: g.type === GuaranteeType.CHEQUE ? g.creditApprovedAmount : null,
          approvedBy: g.approvedBy,
          approvedAt: g.approvedAt,
          approvalFileId: g.approvalFileId,
          notes: 'كان ضمان واتقدّم للتحصيل',
          createdById: user.id,
        }),
      );
      await m.update(ClientGuarantee, { id }, { status: GuaranteeStatus.CONVERTED, paymentId: payment.id });
      return payment;
    });
  }

  /** Link the transfer or LC that replaced a bounced guarantee cheque. */
  @Put(':id/replacement')
  async replacement(
    @CurrentUser() user: User,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceGuaranteeDto,
  ) {
    await this.accounts.clientFor(user, clientId);
    const g = await this.repo.findOneBy({ id, clientId, status: GuaranteeStatus.BOUNCED });
    if (!g || g.removedAt) throw new NotFoundException('Bounced guarantee not found');
    const payment = await this.dataSource.getRepository(Payment).findOneBy({ id: dto.paymentId, clientId });
    if (!payment || payment.removedAt || payment.status === PaymentStatus.BOUNCED) {
      throw new BadRequestException("Not a payment of this client");
    }
    if (payment.method === PaymentMethod.CHEQUE) throw new BadRequestException('Replace it with a transfer or an LC');
    await this.repo.update({ id }, { paymentId: payment.id });
    return this.repo.findOneByOrFail({ id });
  }

  /** Never deleted: a removed guarantee stays listed with its reason and stops counting. */
  @Delete(':id')
  async remove(
    @CurrentUser() user: User,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    await this.accounts.clientFor(user, clientId);
    const result = await this.repo.update({ id, clientId }, { removedAt: new Date(), removedReason: dto.reason });
    if (!result.affected) throw new NotFoundException('Guarantee not found');
    return { ok: true };
  }

  private async active(user: User, clientId: string, id: string) {
    await this.accounts.clientFor(user, clientId);
    const g = await this.repo.findOneBy({ id, clientId });
    if (!g || g.removedAt) throw new NotFoundException('Guarantee not found');
    if (g.status !== GuaranteeStatus.ACTIVE) throw new BadRequestException('This guarantee is no longer held');
    return g;
  }

  private async ownFile(user: User, fileId: string | null | undefined) {
    if (!fileId) return;
    const file = await this.dataSource.getRepository(StoredFile).findOneBy({ id: fileId });
    if (!file || (user.role !== Role.ADMIN && file.uploadedById !== user.id)) throw new BadRequestException('File not found');
  }
}

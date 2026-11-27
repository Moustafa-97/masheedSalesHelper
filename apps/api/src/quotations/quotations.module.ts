import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { InjectDataSource, TypeOrmModule } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Brackets, DataSource, EntityManager, In } from 'typeorm';
import { Client } from '../clients/client.entity.js';
import { CurrentUser, Roles } from '../common/auth.decorators.js';
import { resolveCompetitor } from '../market/competitors.js';
import { LostReason, MarketPrice, PriceSource } from '../market/market.entities.js';
import { ClientProject } from '../orders/order.entities.js';
import { ProductVariant, Unit } from '../products/product.entities.js';
import { Role, User } from '../users/user.entity.js';
import { isUniqueViolation } from '../users/users.module.js';
import { Quotation, QuotationEvent, QuotationLine, QuotationStatus } from './quotation.entities.js';

/* ---------- DTOs ---------- */

export class QuotationLineDto {
  /** An existing line keeps its id, so its changes (and the competitor's price on it) are tracked. */
  @IsOptional() @IsUUID() id?: string;
  @IsString() @MinLength(1) @MaxLength(200) name: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) variantIds?: string[];
  @IsEnum(Unit) unit: Unit;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) qty: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unitPrice: number;
}

export class QuotationDto {
  @IsUUID() clientId: string;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsDateString({ strict: true }) date: string;
  /** 0 = cash, otherwise credit days; defaults to the client's payment terms. */
  @IsOptional() @IsInt() @Min(0) @Max(365) creditDays?: number;
  @IsOptional() @IsString() @MaxLength(120) attn?: string | null;
  @IsOptional() @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @IsEmail() @MaxLength(160) email?: string | null;
  @IsOptional() @IsString() @MaxLength(80) reference?: string | null;
  @IsString() @MinLength(1) @MaxLength(4000) terms: string;
  @IsOptional() @IsString() @MaxLength(120) pdfName?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
  @ValidateNested({ each: true }) @Type(() => QuotationLineDto) @ArrayMinSize(1) @ArrayMaxSize(60)
  lines: QuotationLineDto[];
}

export class UpdateQuotationDto {
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsDateString({ strict: true }) date?: string;
  @IsOptional() @IsInt() @Min(0) @Max(365) creditDays?: number;
  @IsOptional() @IsString() @MaxLength(120) attn?: string | null;
  @IsOptional() @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @IsEmail() @MaxLength(160) email?: string | null;
  @IsOptional() @IsString() @MaxLength(80) reference?: string | null;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(4000) terms?: string;
  @IsOptional() @IsString() @MaxLength(120) pdfName?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
  @IsOptional() @ValidateNested({ each: true }) @Type(() => QuotationLineDto) @ArrayMinSize(1) @ArrayMaxSize(60)
  lines?: QuotationLineDto[];
}

export class QuotationStatusDto {
  @IsEnum(QuotationStatus) status: QuotationStatus;
  /** ACCEPTED: the day the client accepted (defaults to today). */
  @IsOptional() @IsDateString({ strict: true }) acceptedAt?: string;
  /** LOST: the day (defaults to today), why, and who took it at what price and terms. */
  @IsOptional() @IsDateString({ strict: true }) lostAt?: string;
  @IsOptional() @IsEnum(LostReason) lostReasonCode?: LostReason;
  @IsOptional() @IsString() @MaxLength(1000) lostReason?: string;
  @IsOptional() @IsString() @MaxLength(120) competitor?: string;
  @IsOptional() @IsInt() @Min(0) @Max(365) competitorCreditDays?: number;
  @IsOptional() @ValidateNested({ each: true }) @Type(() => LinePriceDto) @ArrayMaxSize(60)
  linePrices?: LinePriceDto[];
}

export class LinePriceDto {
  @IsUUID() lineId: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) price: number;
}

export class ListQuotationsQuery {
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsIn(Object.values(QuotationStatus)) status?: QuotationStatus;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

/* ---------- Service ---------- */

const round2 = (n: number) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

/** Totals as printed: each line excl. VAT, then VAT on the subtotal. */
export function quotationTotals(lines: { qty: number; unitPrice: number }[], vatRate: number) {
  const subtotal = round2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
  const vat = round2((subtotal * vatRate) / 100);
  return { subtotal, vat, total: round2(subtotal + vat) };
}

export interface AcceptedPrice {
  variantId: string;
  unitPrice: number;
  unit: Unit;
  name: string;
  creditDays: number;
  quotationId: string;
  number: string;
  acceptedAt: string;
}

@Injectable()
export class QuotationsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(user: User, query: ListQuotationsQuery) {
    const qb = this.dataSource
      .getRepository(Quotation)
      .createQueryBuilder('q')
      .innerJoinAndSelect('q.client', 'client')
      .leftJoinAndSelect('q.lines', 'line')
      .orderBy('q.date', 'DESC')
      .addOrderBy('q.createdAt', 'DESC');
    this.scope(qb, user);
    if (query.clientId) qb.andWhere('q.clientId = :clientId', { clientId: query.clientId });
    if (query.status) qb.andWhere('q.status = :status', { status: query.status });
    if (query.q) {
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('q.number ILIKE :q', { q: `%${query.q}%` })
            .orWhere('client.name ILIKE :q')
            .orWhere('line.name ILIKE :q'),
        ),
      );
    }
    const rows = await qb.getMany();
    return rows.map((q) => ({
      id: q.id,
      number: q.number,
      date: q.date,
      status: q.status,
      client: { id: q.client.id, name: q.client.name, status: q.client.status },
      lines: q.lines.length,
      items: q.lines.sort((a, b) => a.position - b.position).map((l) => l.name),
      totals: quotationTotals(q.lines, q.vatRate),
    }));
  }

  async get(user: User, id: string, m: EntityManager = this.dataSource.manager) {
    const qb = m
      .getRepository(Quotation)
      .createQueryBuilder('q')
      .innerJoinAndSelect('q.client', 'client')
      .innerJoinAndSelect('q.createdBy', 'createdBy')
      .leftJoinAndSelect('q.competitor', 'competitor')
      .leftJoinAndSelect('q.lines', 'line')
      .where('q.id = :id', { id })
      .orderBy('line.position', 'ASC');
    this.scope(qb, user);
    const q = await qb.getOne();
    if (!q) throw new NotFoundException('Quotation not found');
    const project = q.projectId ? await m.findOneBy(ClientProject, { id: q.projectId }) : null;
    const ids = [...new Set(q.lines.flatMap((l) => l.variantIds))];
    const variants = ids.length
      ? await m.find(ProductVariant, { where: { id: In(ids) }, relations: { product: true, brand: true } })
      : [];
    const byId = new Map(variants.map((v) => [v.id, v]));
    const events = await m.find(QuotationEvent, { where: { quotationId: q.id }, relations: { user: true }, order: { createdAt: 'ASC' } });
    const { createdBy: u, client: c, ...rest } = q;
    return {
      ...rest,
      history: events.map((e) => ({ id: e.id, type: e.type, data: e.data, at: e.createdAt, by: e.user.name })),
      client: {
        id: c.id,
        name: c.name,
        code: c.code,
        status: c.status,
        creditLimit: c.creditLimit,
        paymentTermsDays: c.paymentTermsDays,
      },
      project: project ? { id: project.id, name: project.name } : null,
      /** The salesman block of the PDF. */
      createdBy: { id: u.id, name: u.name, jobTitle: u.jobTitle, phone: u.phone, email: u.email },
      lines: q.lines.map((l) => ({
        ...l,
        items: l.variantIds
          .map((vid) => byId.get(vid))
          .filter((v): v is ProductVariant => !!v)
          .map((v) => ({ id: v.id, name: [v.product.name, v.spec, v.brand?.name].filter(Boolean).join(' — '), unit: v.unit })),
      })),
      totals: quotationTotals(q.lines, q.vatRate),
    };
  }

  async create(user: User, dto: QuotationDto) {
    const id = await this.write(async (m) => {
      const client = await this.clientFor(user, dto.clientId, m);
      if (dto.projectId) await this.projectOf(m, client.id, dto.projectId);
      await this.checkVariants(m, dto.lines);
      const number = await this.nextNumber(m, client);
      const q = await m.save(
        m.create(Quotation, {
          number,
          clientId: client.id,
          projectId: dto.projectId ?? null,
          date: dto.date,
          creditDays: dto.creditDays ?? client.paymentTermsDays,
          attn: clean(dto.attn),
          phone: clean(dto.phone),
          email: clean(dto.email),
          reference: clean(dto.reference),
          terms: dto.terms.trim(),
          pdfName: clean(dto.pdfName),
          notes: clean(dto.notes),
          createdById: user.id,
        }),
      );
      await this.saveLines(m, q.id, dto.lines);
      await this.event(m, q.id, user, 'CREATED', { number });
      return q.id;
    });
    return this.get(user, id);
  }

  /**
   * Any quotation can be edited, accepted and lost ones included (a wrong entry must not skew the
   * analysis). Every change is kept in the history with its before and after, so the negotiation
   * with the client can be followed price by price.
   */
  async update(user: User, id: string, dto: UpdateQuotationDto) {
    await this.write(async (m) => {
      const q = await this.get(user, id, m);
      if (dto.projectId) await this.projectOf(m, q.clientId, dto.projectId);
      const { lines, ...fields } = dto;
      const changes: Record<string, unknown> = {};
      const diff: Record<string, [unknown, unknown]> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined) continue;
        const next = typeof v === 'string' ? (k === 'terms' ? v.trim() : clean(v)) : v;
        const before = (q as unknown as Record<string, unknown>)[k] ?? null;
        if (before === next) continue;
        changes[k] = next;
        // Long texts are logged as changed, without copying them into the history.
        diff[k] = k === 'terms' || k === 'notes' ? [null, null] : [before, next];
      }
      if (Object.keys(changes).length) await m.update(Quotation, { id }, changes);

      let lineDiff: { added: object[]; removed: object[]; changed: object[] } | null = null;
      if (lines) {
        await this.checkVariants(m, lines);
        const old = new Map(q.lines.map((l) => [l.id, l]));
        if (lines.some((l) => l.id && !old.has(l.id))) throw new BadRequestException("A line isn't on this quotation");
        const keep = new Set(lines.map((l) => l.id).filter(Boolean));
        const removed = q.lines.filter((l) => !keep.has(l.id));
        if (removed.length) await m.delete(QuotationLine, { id: In(removed.map((l) => l.id)) });
        const added: object[] = [];
        const changed: object[] = [];
        for (const [i, l] of lines.entries()) {
          const row = {
            position: i,
            name: l.name.trim(),
            variantIds: [...new Set(l.variantIds ?? [])],
            unit: l.unit,
            qty: l.qty,
            unitPrice: l.unitPrice,
          };
          const before = l.id ? old.get(l.id) : undefined;
          if (!before) {
            await m.save(m.create(QuotationLine, { ...row, quotationId: id }));
            added.push({ name: row.name, qty: row.qty, unit: row.unit, unitPrice: row.unitPrice });
            continue;
          }
          const c: Record<string, [unknown, unknown]> = {};
          for (const k of ['name', 'unit', 'qty', 'unitPrice'] as const) if (before[k] !== row[k]) c[k] = [before[k], row[k]];
          if ([...before.variantIds].sort().join() !== [...row.variantIds].sort().join()) c.items = [null, null];
          await m.update(QuotationLine, { id: before.id }, row);
          if (Object.keys(c).length) changed.push({ name: row.name, changes: c });
        }
        const gone = removed.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice }));
        if (added.length || gone.length || changed.length) lineDiff = { added, removed: gone, changed };
      }
      if (Object.keys(diff).length || lineDiff) {
        await this.event(m, id, user, 'EDITED', { status: q.status, fields: diff, ...(lineDiff && { lines: lineDiff }) });
      }
      // A lost quotation's market prices follow its lines (names, items, removed lines).
      if (q.status === QuotationStatus.LOST) await this.syncLostPrices(m, id);
    });
    return this.get(user, id);
  }

  /**
   * Draft → sent → accepted / lost, and every correction: an accepted quotation can be marked lost
   * (or the other way round) or reopened, and the acceptance date or the loss details can be fixed.
   */
  async setStatus(user: User, id: string, dto: QuotationStatusDto) {
    await this.write(async (m) => {
      const q = await this.get(user, id, m);
      const same = q.status === dto.status;
      if (same && dto.status !== QuotationStatus.ACCEPTED && dto.status !== QuotationStatus.LOST) {
        throw new ConflictException('The quotation already has this status');
      }
      const changes: Partial<Quotation> = {
        status: dto.status,
        acceptedAt: null,
        lostAt: null,
        lostReasonCode: null,
        lostReason: null,
        competitorId: null,
        competitorCreditDays: null,
      };
      if (dto.status === QuotationStatus.SENT && !q.sentAt) changes.sentAt = new Date();
      let data: Record<string, unknown> = {};

      if (dto.status === QuotationStatus.ACCEPTED) {
        changes.acceptedAt = dto.acceptedAt ?? (same ? q.acceptedAt : null) ?? today();
        data = { acceptedAt: changes.acceptedAt, ...(same && { before: q.acceptedAt }) };
      }
      await m.update(QuotationLine, { quotationId: id }, { competitorPrice: null });

      if (dto.status === QuotationStatus.LOST) {
        if (!dto.lostReasonCode) throw new BadRequestException('Why was it lost?');
        const note = dto.lostReason?.trim() || null;
        if (dto.lostReasonCode === LostReason.OTHER && !note) throw new BadRequestException('Write the reason');
        const competitor = await resolveCompetitor(m, dto.competitor, user.id);
        const prices = new Map((dto.linePrices ?? []).map((p) => [p.lineId, p.price]));
        if ([...prices.keys()].some((lineId) => !q.lines.some((l) => l.id === lineId))) {
          throw new BadRequestException("A price is for a line that isn't on this quotation");
        }
        Object.assign(changes, {
          lostAt: dto.lostAt ?? today(),
          lostReasonCode: dto.lostReasonCode,
          lostReason: note,
          competitorId: competitor?.id ?? null,
          competitorCreditDays: dto.competitorCreditDays ?? q.creditDays,
        });
        for (const [lineId, price] of prices) await m.update(QuotationLine, { id: lineId }, { competitorPrice: price });
        data = {
          lostAt: changes.lostAt,
          reason: dto.lostReasonCode,
          note,
          competitor: competitor?.name ?? null,
          competitorCreditDays: changes.competitorCreditDays,
          prices: q.lines.filter((l) => prices.has(l.id)).map((l) => ({ name: l.name, ours: l.unitPrice, theirs: prices.get(l.id) })),
        };
      }
      await m.update(Quotation, { id }, changes);
      // The competitor's prices go to the market prices; they're replaced on every change, and a
      // quotation that is no longer lost keeps them (they're still what the market said that day).
      if (dto.status === QuotationStatus.LOST) await this.syncLostPrices(m, id);

      const closed = (s: QuotationStatus) => s === QuotationStatus.ACCEPTED || s === QuotationStatus.LOST;
      const type = closed(q.status) && !closed(dto.status) ? 'REOPENED' : dto.status;
      await this.event(m, id, user, type, { from: q.status, ...data });
    });
    return this.get(user, id);
  }

  /** Rewrites the market prices of a lost quotation from its lines' competitor prices. */
  private async syncLostPrices(m: EntityManager, id: string) {
    const q = await m.findOneOrFail(Quotation, { where: { id }, relations: { lines: true } });
    await m.delete(MarketPrice, { quotationId: id });
    const heard = q.lines.filter((l) => l.competitorPrice !== null);
    if (!heard.length) return;
    await m.save(
      heard.map((l) =>
        m.create(MarketPrice, {
          date: q.lostAt ?? today(),
          name: l.name,
          variantIds: l.variantIds,
          unit: l.unit,
          price: l.competitorPrice!,
          creditDays: q.competitorCreditDays ?? q.creditDays,
          competitorId: q.competitorId,
          source: PriceSource.LOST_QUOTATION,
          quotationId: id,
          notes: null,
          // Kept under the quotation's rep, whoever corrected it, so the rep still sees it.
          createdById: q.createdById,
        }),
      ),
    );
  }

  /** A new draft with the same client, contacts, terms and lines, dated today. */
  async duplicate(user: User, id: string) {
    const q = await this.get(user, id);
    return this.create(user, {
      clientId: q.clientId,
      projectId: q.projectId,
      date: today(),
      creditDays: q.creditDays,
      attn: q.attn,
      phone: q.phone,
      email: q.email,
      reference: q.reference,
      terms: q.terms,
      notes: q.notes,
      lines: q.lines.map((l) => ({ name: l.name, variantIds: l.variantIds, unit: l.unit, qty: l.qty, unitPrice: l.unitPrice })),
    });
  }

  /** The latest accepted price of each catalogue item for this client. */
  async acceptedPrices(user: User, clientId: string): Promise<AcceptedPrice[]> {
    await this.clientFor(user, clientId);
    return this.dataSource.query(
      `SELECT DISTINCT ON (v) v AS "variantId", l."unitPrice"::float AS "unitPrice", l.unit, l.name,
              q."creditDays", q.id AS "quotationId", q.number, to_char(q."acceptedAt", 'YYYY-MM-DD') AS "acceptedAt"
         FROM quotations q
         JOIN quotation_lines l ON l."quotationId" = q.id
         CROSS JOIN LATERAL unnest(l."variantIds") AS v
        WHERE q."clientId" = $1 AND q.status = 'ACCEPTED'
        ORDER BY v, q."acceptedAt" DESC, q."createdAt" DESC`,
      [clientId],
    );
  }

  /* ---------- Helpers ---------- */

  private event(m: EntityManager, quotationId: string, user: User, type: string, data: Record<string, unknown> = {}) {
    return m.save(m.create(QuotationEvent, { quotationId, userId: user.id, type, data }));
  }

  private async write<T>(work: (m: EntityManager) => Promise<T>): Promise<T> {
    // A clash on the number (two quotations at once) is retried once with the next number.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.dataSource.transaction(work);
      } catch (e) {
        if (isUniqueViolation(e) && attempt < 2) continue;
        if (isUniqueViolation(e)) throw new ConflictException('Could not number the quotation; try again');
        throw e;
      }
    }
  }

  private scope(qb: ReturnType<DataSource['createQueryBuilder']>, user: User) {
    if (user.role === Role.REP) qb.andWhere('client.repId = :repId', { repId: user.id });
    else if (user.role !== Role.ADMIN) qb.andWhere('1 = 0');
  }

  private async clientFor(user: User, clientId: string, m: EntityManager = this.dataSource.manager) {
    const client = await m.findOneBy(Client, { id: clientId });
    if (!client || (user.role === Role.REP && client.repId !== user.id) || (user.role !== Role.ADMIN && user.role !== Role.REP)) {
      throw new NotFoundException('Client not found');
    }
    return client;
  }

  private async projectOf(m: EntityManager, clientId: string, projectId: string) {
    if (!(await m.existsBy(ClientProject, { id: projectId, clientId }))) {
      throw new BadRequestException("The project isn't one of this client's projects");
    }
  }

  private async checkVariants(m: EntityManager, lines: QuotationLineDto[]) {
    const ids = [...new Set(lines.flatMap((l) => l.variantIds ?? []))];
    if (ids.length && (await m.countBy(ProductVariant, { id: In(ids) })) !== ids.length) {
      throw new BadRequestException('A linked item is not in the catalogue');
    }
  }

  private saveLines(m: EntityManager, quotationId: string, lines: QuotationLineDto[]) {
    return m.save(
      lines.map((l, i) =>
        m.create(QuotationLine, {
          quotationId,
          position: i,
          name: l.name.trim(),
          variantIds: [...new Set(l.variantIds ?? [])],
          unit: l.unit,
          qty: l.qty,
          unitPrice: l.unitPrice,
        }),
      ),
    );
  }

  /** The client's code and its next sequence (B2B-722-00003), or NEW-00012 for a client without a code. */
  private async nextNumber(m: EntityManager, client: Client) {
    const prefix = client.code?.trim() || 'NEW';
    const [row] = await m.query(
      `SELECT COALESCE(MAX(NULLIF(substring(number FROM '-(\\d+)$'), '')::int), 0) AS n
         FROM quotations WHERE number LIKE $1`,
      [`${prefix.replace(/[\\%_]/g, '\\$&')}-%`],
    );
    return `${prefix}-${String(Number(row.n) + 1).padStart(5, '0')}`;
  }
}

const clean = (v: string | null | undefined) => (typeof v === 'string' ? v.trim() || null : null);

/* ---------- Controller ---------- */

@Controller()
@Roles(Role.ADMIN, Role.REP)
export class QuotationsController {
  constructor(private readonly quotations: QuotationsService) {}

  @Get('quotations')
  list(@CurrentUser() user: User, @Query() query: ListQuotationsQuery) {
    return this.quotations.list(user, query);
  }

  @Get('quotations/:id')
  get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotations.get(user, id);
  }

  @Post('quotations')
  create(@CurrentUser() user: User, @Body() dto: QuotationDto) {
    return this.quotations.create(user, dto);
  }

  @Patch('quotations/:id')
  update(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateQuotationDto) {
    return this.quotations.update(user, id, dto);
  }

  @Put('quotations/:id/status')
  status(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: QuotationStatusDto) {
    return this.quotations.setStatus(user, id, dto);
  }

  @Post('quotations/:id/duplicate')
  duplicate(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotations.duplicate(user, id);
  }

  /** Latest accepted price per catalogue item: prefills the client's next order. */
  @Get('clients/:clientId/accepted-prices')
  acceptedPrices(@CurrentUser() user: User, @Param('clientId', ParseUUIDPipe) clientId: string) {
    return this.quotations.acceptedPrices(user, clientId);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Quotation, QuotationLine, QuotationEvent])],
  controllers: [QuotationsController],
  providers: [QuotationsService],
})
export class QuotationsModule {}

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { InjectDataSource, TypeOrmModule } from '@nestjs/typeorm';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DataSource, EntityManager, In } from 'typeorm';
import { Client } from '../clients/client.entity.js';
import { CurrentUser, Roles } from '../common/auth.decorators.js';
import { ProductVariant, Unit } from '../products/product.entities.js';
import { Quotation, QuotationStatus } from '../quotations/quotation.entities.js';
import { Role, User } from '../users/user.entity.js';
import { resolveCompetitor } from './competitors.js';
import { Competitor, competitorKey, LostDeal, LostDealLine, LostReason, MarketPrice, PriceSource } from './market.entities.js';

/* ---------- DTOs ---------- */

const MANUAL_SOURCES = [PriceSource.CLIENT, PriceSource.SUPPLIER, PriceSource.MARKET] as const;
const csv = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value);

export class CompetitorDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
}

export class MergeCompetitorDto {
  @IsUUID() intoId: string;
}

export class LostDealLineDto {
  @IsString() @MinLength(1) @MaxLength(200) name: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) variantIds?: string[];
  @IsEnum(Unit) unit: Unit;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) qty: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) ourPrice?: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) competitorPrice?: number | null;
}

export class LostDealDto {
  @IsDateString({ strict: true }) date: string;
  @IsOptional() @IsUUID() clientId?: string | null;
  @IsOptional() @IsString() @MaxLength(160) clientName?: string | null;
  @IsOptional() @IsString() @MaxLength(40) zone?: string | null;
  @IsEnum(LostReason) reason: LostReason;
  @IsOptional() @IsString() @MaxLength(2000) note?: string | null;
  @IsOptional() @IsString() @MaxLength(120) competitor?: string | null;
  @IsInt() @Min(0) @Max(365) creditDays: number;
  @IsInt() @Min(0) @Max(365) competitorCreditDays: number;
  @ValidateNested({ each: true }) @Type(() => LostDealLineDto) @ArrayMinSize(1) @ArrayMaxSize(60)
  lines: LostDealLineDto[];
}

export class MarketPriceDto {
  @IsDateString({ strict: true }) date: string;
  @IsString() @MinLength(1) @MaxLength(200) name: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) variantIds?: string[];
  @IsEnum(Unit) unit: Unit;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) price: number;
  @IsInt() @Min(0) @Max(365) creditDays: number;
  @IsOptional() @IsString() @MaxLength(120) competitor?: string | null;
  @IsOptional() @IsString() @MaxLength(40) zone?: string | null;
  @IsIn(MANUAL_SOURCES) source: PriceSource;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}

export class RangeQuery {
  @IsOptional() @IsDateString({ strict: true }) from?: string;
  @IsOptional() @IsDateString({ strict: true }) to?: string;
}

export class LostQuery extends RangeQuery {
  @IsOptional() @IsEnum(LostReason) reason?: LostReason;
  @IsOptional() @IsUUID() competitorId?: string;
}

export class MarketQuery extends RangeQuery {
  @IsOptional() @IsUUID() variantId?: string;
  @IsOptional() @IsUUID() competitorId?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class LatestQuery {
  @Transform(csv) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID('all', { each: true }) variantIds: string[];
}

/* ---------- Helpers ---------- */

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;
const clean = (v: string | null | undefined) => (typeof v === 'string' ? v.trim() || null : null);
/** The analysis looks at the last 6 months unless told otherwise. */
const range = (q: RangeQuery) => ({ from: q.from ?? daysAgo(182), to: q.to ?? today() });

export interface LostEntry {
  kind: 'QUOTATION' | 'DEAL';
  id: string;
  date: string;
  number: string | null;
  client: { id: string | null; name: string };
  items: string[];
  value: number;
  reason: LostReason;
  note: string | null;
  competitor: { id: string; name: string } | null;
  creditDays: number;
  competitorCreditDays: number;
  /** Line by line: our price and theirs, when known. */
  prices: { name: string; unit: Unit; qty: number; ours: number | null; theirs: number | null }[];
  createdBy: string;
}

/* ---------- Service ---------- */

@Injectable()
export class MarketService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /* Competitors */

  async competitors() {
    const rows: { id: string; name: string; uses: number }[] = await this.dataSource.query(
      `SELECT c.id, c.name,
              ((SELECT count(*) FROM market_prices p WHERE p."competitorId" = c.id)
             + (SELECT count(*) FROM lost_deals d WHERE d."competitorId" = c.id)
             + (SELECT count(*) FROM quotations q WHERE q."competitorId" = c.id))::int AS uses
         FROM competitors c ORDER BY lower(c.name)`,
    );
    return rows;
  }

  addCompetitor(user: User, dto: CompetitorDto) {
    return this.dataSource.transaction((m) => resolveCompetitor(m, dto.name, user.id));
  }

  async renameCompetitor(id: string, dto: CompetitorDto) {
    const name = dto.name.trim().replace(/\s+/g, ' ');
    const clash = await this.dataSource.getRepository(Competitor).findOneBy({ key: competitorKey(name) });
    if (clash && clash.id !== id) throw new BadRequestException(`"${clash.name}" is already on the list; merge them instead`);
    const res = await this.dataSource.getRepository(Competitor).update({ id }, { name, key: competitorKey(name) });
    if (!res.affected) throw new NotFoundException('Competitor not found');
    return this.dataSource.getRepository(Competitor).findOneByOrFail({ id });
  }

  /** Two names for the same company: everything recorded under one moves to the other. */
  async mergeCompetitor(id: string, dto: MergeCompetitorDto) {
    if (id === dto.intoId) throw new BadRequestException('Choose a different competitor');
    return this.dataSource.transaction(async (m) => {
      const [from, into] = await Promise.all([m.findOneBy(Competitor, { id }), m.findOneBy(Competitor, { id: dto.intoId })]);
      if (!from || !into) throw new NotFoundException('Competitor not found');
      for (const entity of [MarketPrice, LostDeal, Quotation]) {
        await m.update(entity, { competitorId: id }, { competitorId: into.id });
      }
      await m.delete(Competitor, { id });
      return into;
    });
  }

  /* Lost deals (the manual ones) and the combined list */

  async lost(user: User, query: LostQuery): Promise<LostEntry[]> {
    const { from, to } = range(query);
    const qb = this.dataSource
      .getRepository(Quotation)
      .createQueryBuilder('q')
      .innerJoinAndSelect('q.client', 'client')
      .innerJoinAndSelect('q.createdBy', 'createdBy')
      .leftJoinAndSelect('q.competitor', 'competitor')
      .leftJoinAndSelect('q.lines', 'line')
      .where('q.status = :lost', { lost: QuotationStatus.LOST })
      .andWhere('q.lostAt BETWEEN :from AND :to', { from, to });
    if (user.role === Role.REP) qb.andWhere('client.repId = :me', { me: user.id });
    if (query.reason) qb.andWhere('q.lostReasonCode = :reason', { reason: query.reason });
    if (query.competitorId) qb.andWhere('q.competitorId = :cid', { cid: query.competitorId });

    const dq = this.dataSource
      .getRepository(LostDeal)
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.client', 'client')
      .innerJoinAndSelect('d.createdBy', 'createdBy')
      .leftJoinAndSelect('d.competitor', 'competitor')
      .leftJoinAndSelect('d.lines', 'line')
      .where('d.date BETWEEN :from AND :to', { from, to });
    if (user.role === Role.REP) dq.andWhere('d.createdById = :me', { me: user.id });
    if (query.reason) dq.andWhere('d.reason = :reason', { reason: query.reason });
    if (query.competitorId) dq.andWhere('d.competitorId = :cid', { cid: query.competitorId });

    const [quotes, deals] = await Promise.all([qb.getMany(), dq.getMany()]);
    const fromQuotes: LostEntry[] = quotes.map((q) => {
      const lines = q.lines.sort((a, b) => a.position - b.position);
      return {
        kind: 'QUOTATION',
        id: q.id,
        date: q.lostAt!,
        number: q.number,
        client: { id: q.client.id, name: q.client.name },
        items: lines.map((l) => l.name),
        value: round2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0)),
        reason: q.lostReasonCode ?? LostReason.OTHER,
        note: q.lostReason,
        competitor: q.competitor ? { id: q.competitor.id, name: q.competitor.name } : null,
        creditDays: q.creditDays,
        competitorCreditDays: q.competitorCreditDays ?? q.creditDays,
        prices: lines.map((l) => ({ name: l.name, unit: l.unit, qty: l.qty, ours: l.unitPrice, theirs: l.competitorPrice })),
        createdBy: q.createdBy.name,
      };
    });
    const fromDeals: LostEntry[] = deals.map((d) => this.dealEntry(d));
    return [...fromQuotes, ...fromDeals].sort((a, b) => b.date.localeCompare(a.date));
  }

  async getDeal(user: User, id: string, m: EntityManager = this.dataSource.manager) {
    const d = await m.findOne(LostDeal, {
      where: { id },
      relations: { client: true, createdBy: true, competitor: true, lines: true },
    });
    if (!d || (user.role !== Role.ADMIN && d.createdById !== user.id)) throw new NotFoundException('Lost deal not found');
    return { ...this.dealEntry(d), zone: d.zone, lines: d.lines.sort((a, b) => a.position - b.position) };
  }

  async saveDeal(user: User, dto: LostDealDto, id?: string) {
    const dealId = await this.dataSource.transaction(async (m) => {
      if (id) await this.getDeal(user, id, m);
      let clientName = clean(dto.clientName);
      if (dto.clientId) {
        const client = await m.findOneBy(Client, { id: dto.clientId });
        if (!client || (user.role === Role.REP && client.repId !== user.id)) throw new NotFoundException('Client not found');
        clientName = null;
      }
      if (!dto.clientId && !clientName) throw new BadRequestException('Choose the client or type its name');
      const note = clean(dto.note);
      if (dto.reason === LostReason.OTHER && !note) throw new BadRequestException('Write the reason');
      await checkVariants(m, dto.lines);
      const competitor = await resolveCompetitor(m, dto.competitor, user.id);
      const fields = {
        date: dto.date,
        clientId: dto.clientId ?? null,
        clientName,
        zone: clean(dto.zone),
        reason: dto.reason,
        note,
        competitorId: competitor?.id ?? null,
        creditDays: dto.creditDays,
        competitorCreditDays: dto.competitorCreditDays,
      };
      let saved: string;
      if (id) {
        await m.update(LostDeal, { id }, fields);
        await m.delete(LostDealLine, { lostDealId: id });
        await m.delete(MarketPrice, { lostDealId: id });
        saved = id;
      } else {
        saved = (await m.save(m.create(LostDeal, { ...fields, createdById: user.id }))).id;
      }
      await m.save(
        dto.lines.map((l, i) =>
          m.create(LostDealLine, {
            lostDealId: saved,
            position: i,
            name: l.name.trim(),
            variantIds: [...new Set(l.variantIds ?? [])],
            unit: l.unit,
            qty: l.qty,
            ourPrice: l.ourPrice ?? null,
            competitorPrice: l.competitorPrice ?? null,
          }),
        ),
      );
      // The competitor's prices also go to the market prices, so they're never typed twice.
      const heard = dto.lines.filter((l) => l.competitorPrice != null && l.competitorPrice > 0);
      if (heard.length) {
        await m.save(
          heard.map((l) =>
            m.create(MarketPrice, {
              date: dto.date,
              name: l.name.trim(),
              variantIds: [...new Set(l.variantIds ?? [])],
              unit: l.unit,
              price: l.competitorPrice!,
              creditDays: dto.competitorCreditDays,
              competitorId: competitor?.id ?? null,
              zone: fields.zone,
              source: PriceSource.LOST_DEAL,
              lostDealId: saved,
              createdById: user.id,
            }),
          ),
        );
      }
      return saved;
    });
    return this.getDeal(user, dealId);
  }

  async removeDeal(user: User, id: string) {
    await this.getDeal(user, id);
    await this.dataSource.getRepository(LostDeal).delete({ id });
  }

  /* Market prices */

  async prices(user: User, query: MarketQuery) {
    const { from, to } = range(query);
    const qb = this.dataSource
      .getRepository(MarketPrice)
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.competitor', 'competitor')
      .innerJoinAndSelect('p.createdBy', 'createdBy')
      .leftJoin('p.quotation', 'quotation')
      .addSelect(['quotation.id', 'quotation.number'])
      .where('p.date BETWEEN :from AND :to', { from, to })
      .orderBy('p.date', 'DESC')
      .addOrderBy('p.createdAt', 'DESC');
    if (user.role === Role.REP) qb.andWhere('p.createdById = :me', { me: user.id });
    if (query.variantId) qb.andWhere(':vid = ANY(p.variantIds)', { vid: query.variantId });
    if (query.competitorId) qb.andWhere('p.competitorId = :cid', { cid: query.competitorId });
    if (query.q) qb.andWhere('(p.name ILIKE :q OR competitor.name ILIKE :q)', { q: `%${query.q}%` });
    const rows = await qb.getMany();
    return rows.map((p) => this.priceView(p));
  }

  async addPrice(user: User, dto: MarketPriceDto) {
    const id = await this.dataSource.transaction(async (m) => {
      await checkVariants(m, [dto]);
      const competitor = await resolveCompetitor(m, dto.competitor, user.id);
      const p = await m.save(m.create(MarketPrice, { ...this.priceFields(dto), competitorId: competitor?.id ?? null, createdById: user.id }));
      return p.id;
    });
    return this.priceById(id);
  }

  async updatePrice(user: User, id: string, dto: MarketPriceDto) {
    await this.dataSource.transaction(async (m) => {
      await this.ownPrice(user, id, m);
      await checkVariants(m, [dto]);
      const competitor = await resolveCompetitor(m, dto.competitor, user.id);
      await m.update(MarketPrice, { id }, { ...this.priceFields(dto), competitorId: competitor?.id ?? null });
    });
    return this.priceById(id);
  }

  async removePrice(user: User, id: string) {
    await this.ownPrice(user, id);
    await this.dataSource.getRepository(MarketPrice).delete({ id });
  }

  /** The latest prices heard for each item: the hint under a price while quoting or ordering. */
  async latest(user: User, variantIds: string[]) {
    const params: unknown[] = [variantIds];
    let scope = '';
    if (user.role === Role.REP) {
      params.push(user.id);
      scope = `AND p."createdById" = $2`;
    }
    const rows: {
      variantId: string;
      price: number;
      creditDays: number;
      date: string;
      unit: Unit;
      competitor: string | null;
      zone: string | null;
      source: PriceSource;
    }[] = await this.dataSource.query(
      `SELECT * FROM (
         SELECT v AS "variantId", p.price::float AS price, p."creditDays", to_char(p.date, 'YYYY-MM-DD') AS date,
                p.unit, c.name AS competitor, p.zone, p.source,
                row_number() OVER (PARTITION BY v, p."creditDays" ORDER BY p.date DESC, p."createdAt" DESC) AS n
           FROM market_prices p
           CROSS JOIN LATERAL unnest(p."variantIds") AS v
           LEFT JOIN competitors c ON c.id = p."competitorId"
          WHERE v = ANY($1::uuid[]) ${scope}
       ) x WHERE n = 1 ORDER BY date DESC`,
      params,
    );
    return rows.map(({ ...r }) => {
      delete (r as { n?: unknown }).n;
      return r;
    });
  }

  /* Analysis */

  async analysis(user: User, query: RangeQuery) {
    const { from, to } = range(query);
    const me = user.role === Role.REP ? user.id : null;

    // 1. Item by item, at the same payment terms: the latest market price against our latest accepted price.
    const market: {
      variantId: string | null;
      name: string;
      unit: Unit;
      creditDays: number;
      price: number;
      date: string;
      competitor: string | null;
    }[] = await this.dataSource.query(
      `SELECT v AS "variantId", p.name, p.unit, p."creditDays", p.price::float AS price,
              to_char(p.date, 'YYYY-MM-DD') AS date, c.name AS competitor
         FROM market_prices p
         LEFT JOIN LATERAL unnest(CASE WHEN cardinality(p."variantIds") = 0 THEN ARRAY[NULL::uuid] ELSE p."variantIds" END) AS v ON true
         LEFT JOIN competitors c ON c.id = p."competitorId"
        WHERE p.date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR p."createdById" = $3)
        ORDER BY p.date DESC, p."createdAt" DESC`,
      [from, to, me],
    );
    const ours: { variantId: string; creditDays: number; unitPrice: number; acceptedAt: string; client: string; number: string }[] =
      await this.dataSource.query(
        `SELECT DISTINCT ON (v, q."creditDays") v AS "variantId", q."creditDays", l."unitPrice"::float AS "unitPrice",
                to_char(q."acceptedAt", 'YYYY-MM-DD') AS "acceptedAt", c.name AS client, q.number
           FROM quotations q
           JOIN clients c ON c.id = q."clientId"
           JOIN quotation_lines l ON l."quotationId" = q.id
           CROSS JOIN LATERAL unnest(l."variantIds") AS v
          WHERE q.status = 'ACCEPTED' AND ($1::uuid IS NULL OR c."repId" = $1)
          ORDER BY v, q."creditDays", q."acceptedAt" DESC, q."createdAt" DESC`,
        [me],
      );
    const variantIds = [...new Set(market.map((r) => r.variantId).filter((v): v is string => !!v))];
    const variants = variantIds.length
      ? await this.dataSource.getRepository(ProductVariant).find({ where: { id: In(variantIds) }, relations: { product: true, brand: true } })
      : [];
    const vName = new Map(variants.map((v) => [v.id, [v.product.name, v.spec, v.brand?.name].filter(Boolean).join(' — ')]));
    const ourBy = new Map(ours.map((o) => [`${o.variantId}|${o.creditDays}`, o]));

    const groups = new Map<string, { rows: typeof market }>();
    for (const r of market) {
      const key = `${r.variantId ?? `name:${r.name.trim().toLowerCase()}`}|${r.creditDays}`;
      if (!groups.has(key)) groups.set(key, { rows: [] });
      groups.get(key)!.rows.push(r);
    }
    const items = [...groups.values()].map(({ rows }) => {
      const latest = rows[0];
      const our = latest.variantId ? ourBy.get(`${latest.variantId}|${latest.creditDays}`) : undefined;
      const low = rows.reduce((a, b) => (b.price < a.price ? b : a));
      return {
        variantId: latest.variantId,
        name: latest.variantId ? (vName.get(latest.variantId) ?? latest.name) : latest.name,
        unit: latest.unit,
        creditDays: latest.creditDays,
        market: { price: latest.price, date: latest.date, competitor: latest.competitor },
        lowest: { price: low.price, date: low.date, competitor: low.competitor },
        count: rows.length,
        ours: our ? { price: our.unitPrice, date: our.acceptedAt, client: our.client, number: our.number } : null,
        /** + means we are above the market. */
        diffPct: our ? round2(((our.unitPrice - latest.price) / latest.price) * 100) : null,
      };
    });
    items.sort((a, b) => a.name.localeCompare(b.name) || a.creditDays - b.creditDays);

    // 2. Lost deals by month, reason and competitor.
    const lost = await this.lost(user, { from, to });
    const tally = <K extends string>(key: (e: LostEntry) => K) => {
      const map = new Map<K, { count: number; value: number }>();
      for (const e of lost) {
        const t = map.get(key(e)) ?? { count: 0, value: 0 };
        t.count++;
        t.value = round2(t.value + e.value);
        map.set(key(e), t);
      }
      return [...map.entries()].map(([k, t]) => ({ key: k, ...t }));
    };
    const byMonth = tally((e) => e.date.slice(0, 7)).sort((a, b) => a.key.localeCompare(b.key));
    const byReason = tally((e) => e.reason).sort((a, b) => b.value - a.value);
    const byCompetitor = tally((e) => e.competitor?.name ?? '').sort((a, b) => b.value - a.value);

    // 3. Quotations decided in the period: won against lost.
    const [decided]: { won: number; lost: number; wonValue: number; lostValue: number }[] = await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE q.status = 'ACCEPTED')::int AS won,
              count(*) FILTER (WHERE q.status = 'LOST')::int AS lost,
              coalesce(sum(t.v) FILTER (WHERE q.status = 'ACCEPTED'), 0)::float AS "wonValue",
              coalesce(sum(t.v) FILTER (WHERE q.status = 'LOST'), 0)::float AS "lostValue"
         FROM quotations q
         JOIN clients c ON c.id = q."clientId"
         CROSS JOIN LATERAL (SELECT sum(l.qty * l."unitPrice") AS v FROM quotation_lines l WHERE l."quotationId" = q.id) t
        WHERE ((q.status = 'ACCEPTED' AND q."acceptedAt" BETWEEN $1 AND $2) OR (q.status = 'LOST' AND q."lostAt" BETWEEN $1 AND $2))
          AND ($3::uuid IS NULL OR c."repId" = $3)`,
      [from, to, me],
    );
    const total = decided.won + decided.lost;

    return {
      from,
      to,
      items,
      lost: {
        count: lost.length,
        value: round2(lost.reduce((s, e) => s + e.value, 0)),
        byMonth,
        byReason,
        byCompetitor,
      },
      quotations: {
        ...decided,
        wonValue: round2(decided.wonValue),
        lostValue: round2(decided.lostValue),
        winRate: total ? round2((decided.won / total) * 100) : null,
      },
    };
  }

  /* Helpers */

  private dealEntry(d: LostDeal): LostEntry {
    const lines = [...d.lines].sort((a, b) => a.position - b.position);
    return {
      kind: 'DEAL',
      id: d.id,
      date: d.date,
      number: null,
      client: { id: d.clientId, name: d.client?.name ?? d.clientName ?? '' },
      items: lines.map((l) => l.name),
      value: round2(lines.reduce((s, l) => s + l.qty * (l.ourPrice ?? l.competitorPrice ?? 0), 0)),
      reason: d.reason,
      note: d.note,
      competitor: d.competitor ? { id: d.competitor.id, name: d.competitor.name } : null,
      creditDays: d.creditDays,
      competitorCreditDays: d.competitorCreditDays,
      prices: lines.map((l) => ({ name: l.name, unit: l.unit, qty: l.qty, ours: l.ourPrice, theirs: l.competitorPrice })),
      createdBy: d.createdBy.name,
    };
  }

  private priceFields(dto: MarketPriceDto) {
    return {
      date: dto.date,
      name: dto.name.trim(),
      variantIds: [...new Set(dto.variantIds ?? [])],
      unit: dto.unit,
      price: dto.price,
      creditDays: dto.creditDays,
      zone: clean(dto.zone),
      source: dto.source,
      notes: clean(dto.notes),
    };
  }

  private priceView(p: MarketPrice) {
    const { competitor, createdBy, quotation, ...rest } = p;
    return {
      ...rest,
      competitor: competitor ? { id: competitor.id, name: competitor.name } : null,
      quotation: quotation ? { id: quotation.id, number: quotation.number } : null,
      createdBy: createdBy.name,
      /** Written from a lost quotation or lost deal: changed there, not here. */
      automatic: p.source === PriceSource.LOST_QUOTATION || p.source === PriceSource.LOST_DEAL,
    };
  }

  private async priceById(id: string) {
    const p = await this.dataSource.getRepository(MarketPrice).findOneOrFail({
      where: { id },
      relations: { competitor: true, createdBy: true, quotation: true },
    });
    return this.priceView(p);
  }

  private async ownPrice(user: User, id: string, m: EntityManager = this.dataSource.manager) {
    const p = await m.findOneBy(MarketPrice, { id });
    if (!p || (user.role !== Role.ADMIN && p.createdById !== user.id)) throw new NotFoundException('Price not found');
    if (p.source === PriceSource.LOST_QUOTATION || p.source === PriceSource.LOST_DEAL) {
      throw new ForbiddenException('This price came from a lost deal; change it there');
    }
    return p;
  }
}

async function checkVariants(m: EntityManager, lines: { variantIds?: string[] }[]) {
  const ids = [...new Set(lines.flatMap((l) => l.variantIds ?? []))];
  if (ids.length && (await m.countBy(ProductVariant, { id: In(ids) })) !== ids.length) {
    throw new BadRequestException('A linked item is not in the catalogue');
  }
}

/* ---------- Controller ---------- */

@Controller()
@Roles(Role.ADMIN, Role.REP)
export class MarketController {
  constructor(private readonly market: MarketService) {}

  @Get('competitors')
  competitors() {
    return this.market.competitors();
  }

  @Post('competitors')
  addCompetitor(@CurrentUser() user: User, @Body() dto: CompetitorDto) {
    return this.market.addCompetitor(user, dto);
  }

  @Patch('competitors/:id')
  @Roles(Role.ADMIN)
  renameCompetitor(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompetitorDto) {
    return this.market.renameCompetitor(id, dto);
  }

  @Post('competitors/:id/merge')
  @Roles(Role.ADMIN)
  mergeCompetitor(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MergeCompetitorDto) {
    return this.market.mergeCompetitor(id, dto);
  }

  @Get('lost-deals')
  lost(@CurrentUser() user: User, @Query() query: LostQuery) {
    return this.market.lost(user, query);
  }

  @Get('lost-deals/:id')
  getDeal(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.market.getDeal(user, id);
  }

  @Post('lost-deals')
  addDeal(@CurrentUser() user: User, @Body() dto: LostDealDto) {
    return this.market.saveDeal(user, dto);
  }

  @Patch('lost-deals/:id')
  updateDeal(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LostDealDto) {
    return this.market.saveDeal(user, dto, id);
  }

  @Delete('lost-deals/:id')
  @HttpCode(204)
  removeDeal(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.market.removeDeal(user, id);
  }

  @Get('market-prices')
  prices(@CurrentUser() user: User, @Query() query: MarketQuery) {
    return this.market.prices(user, query);
  }

  @Get('market-prices/latest')
  latest(@CurrentUser() user: User, @Query() query: LatestQuery) {
    return this.market.latest(user, query.variantIds);
  }

  @Post('market-prices')
  addPrice(@CurrentUser() user: User, @Body() dto: MarketPriceDto) {
    return this.market.addPrice(user, dto);
  }

  @Patch('market-prices/:id')
  updatePrice(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MarketPriceDto) {
    return this.market.updatePrice(user, id, dto);
  }

  @Delete('market-prices/:id')
  @HttpCode(204)
  removePrice(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.market.removePrice(user, id);
  }

  @Get('market/analysis')
  analysis(@CurrentUser() user: User, @Query() query: RangeQuery) {
    return this.market.analysis(user, query);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Competitor, LostDeal, LostDealLine, MarketPrice])],
  controllers: [MarketController],
  providers: [MarketService],
})
export class MarketModule {}

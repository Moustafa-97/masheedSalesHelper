import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { Competitor, competitorKey } from './market.entities.js';

/**
 * The competitor with this name (spelling case and spaces don't matter), added to the list if new.
 * Returns null for an empty name.
 */
export async function resolveCompetitor(m: EntityManager, name: string | null | undefined, userId: string) {
  const clean = name?.trim().replace(/\s+/g, ' ');
  if (!clean) return null;
  if (clean.length > 120) throw new BadRequestException('Competitor name is too long');
  const key = competitorKey(clean);
  await m
    .createQueryBuilder()
    .insert()
    .into(Competitor)
    .values({ name: clean, key, createdById: userId })
    .orIgnore()
    .execute();
  return m.findOneByOrFail(Competitor, { key });
}

import type { MigrationInterface, QueryRunner } from "typeorm";

export class MarketPrices1795803021443 implements MigrationInterface {
    name = 'MarketPrices1795803021443'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "competitors" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(120) NOT NULL, "key" character varying(120) NOT NULL, "createdById" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_76a451dd0c8a51a0e0fb6284389" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_374f5a92c2408ee1eb52659af6" ON "competitors"  ("key") `);
        await queryRunner.query(`CREATE TYPE "public"."lost_deals_reason_enum" AS ENUM('PRICE', 'PAYMENT_TERMS', 'DELIVERY', 'AVAILABILITY', 'RELATIONSHIP', 'OTHER')`);
        await queryRunner.query(`CREATE TABLE "lost_deals" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "date" date NOT NULL, "clientId" uuid, "clientName" character varying(160), "zone" character varying(40), "reason" "public"."lost_deals_reason_enum" NOT NULL, "note" text, "competitorId" uuid, "creditDays" integer NOT NULL DEFAULT '0', "competitorCreditDays" integer NOT NULL DEFAULT '0', "createdById" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8155069447ebc8f124ab2366570" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_9141e57d72bf496da972ade1bf" ON "lost_deals"  ("date") `);
        await queryRunner.query(`CREATE TABLE "lost_deal_lines" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "lostDealId" uuid NOT NULL, "position" integer NOT NULL DEFAULT '0', "name" character varying(200) NOT NULL, "variantIds" uuid array NOT NULL DEFAULT '{}', "unit" "public"."product_variants_unit_enum" NOT NULL, "qty" numeric(12,3) NOT NULL, "ourPrice" numeric(12,2), "competitorPrice" numeric(12,2), CONSTRAINT "PK_818e8426cf7e6ec7683410dbd95" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."market_prices_source_enum" AS ENUM('CLIENT', 'SUPPLIER', 'MARKET', 'LOST_QUOTATION', 'LOST_DEAL')`);
        await queryRunner.query(`CREATE TABLE "market_prices" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "date" date NOT NULL, "name" character varying(200) NOT NULL, "variantIds" uuid array NOT NULL DEFAULT '{}', "unit" "public"."product_variants_unit_enum" NOT NULL, "price" numeric(12,2) NOT NULL, "creditDays" integer NOT NULL DEFAULT '0', "competitorId" uuid, "zone" character varying(40), "source" "public"."market_prices_source_enum" NOT NULL, "quotationId" uuid, "lostDealId" uuid, "notes" text, "createdById" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cb959017562b6fe816d5a5c91dd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_88986956a51d5bc7b75a54c36e" ON "market_prices"  ("date") `);
        await queryRunner.query(`CREATE TABLE "quotation_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "quotationId" uuid NOT NULL, "userId" uuid NOT NULL, "type" character varying(40) NOT NULL, "data" jsonb NOT NULL DEFAULT '{}', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a7c47886efd3f252523ff0bfb2d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_ae3ea97c4bdd7712274c62bcc7" ON "quotation_events"  ("quotationId", "createdAt") `);
        await queryRunner.query(`ALTER TABLE "quotations" ADD "creditDays" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "quotations" ADD "lostAt" date`);
        await queryRunner.query(`ALTER TABLE "quotations" ADD "lostReasonCode" "public"."lost_deals_reason_enum"`);
        await queryRunner.query(`ALTER TABLE "quotations" ADD "competitorId" uuid`);
        await queryRunner.query(`ALTER TABLE "quotations" ADD "competitorCreditDays" integer`);
        await queryRunner.query(`ALTER TABLE "quotation_lines" ADD "competitorPrice" numeric(12,2)`);
        // Existing quotations: payment terms read from the printed terms, and the old free-text lost
        // details moved to the competitors list, the lines and the market prices.
        await queryRunner.query(`UPDATE "quotations" q SET "creditDays" = CASE WHEN q.terms ILIKE '%Payment: Cash%' THEN 0 ELSE c."paymentTermsDays" END FROM "clients" c WHERE c.id = q."clientId"`);
        await queryRunner.query(`INSERT INTO "competitors" ("name", "key") SELECT DISTINCT ON (lower(regexp_replace(trim(competitor), '\\s+', ' ', 'g'))) regexp_replace(trim(competitor), '\\s+', ' ', 'g'), lower(regexp_replace(trim(competitor), '\\s+', ' ', 'g')) FROM "quotations" WHERE trim(coalesce(competitor, '')) <> '' ON CONFLICT DO NOTHING`);
        await queryRunner.query(`UPDATE "quotations" q SET "competitorId" = k.id FROM "competitors" k WHERE k.key = lower(regexp_replace(trim(q.competitor), '\\s+', ' ', 'g'))`);
        await queryRunner.query(`UPDATE "quotations" SET "lostAt" = "updatedAt"::date, "lostReasonCode" = 'OTHER', "competitorCreditDays" = "creditDays" WHERE status::text = 'LOST'`);
        await queryRunner.query(`UPDATE "quotation_lines" l SET "competitorPrice" = q."competitorPrice" FROM "quotations" q WHERE q.id = l."quotationId" AND q.status::text = 'LOST' AND q."competitorPrice" IS NOT NULL`);
        await queryRunner.query(`INSERT INTO "market_prices" ("date", "name", "variantIds", "unit", "price", "creditDays", "competitorId", "source", "quotationId", "createdById") SELECT q."lostAt", l.name, l."variantIds", l.unit, l."competitorPrice", q."competitorCreditDays", q."competitorId", 'LOST_QUOTATION', q.id, q."createdById" FROM "quotation_lines" l JOIN "quotations" q ON q.id = l."quotationId" WHERE l."competitorPrice" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "quotations" DROP COLUMN "competitorPrice"`);
        await queryRunner.query(`ALTER TABLE "quotations" DROP COLUMN "competitor"`);
        await queryRunner.query(`ALTER TABLE "lost_deals" ADD CONSTRAINT "FK_40ba88ab2589ba5189f1ae9e9ee" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "lost_deals" ADD CONSTRAINT "FK_10065e78b0910beb749ab027db0" FOREIGN KEY ("competitorId") REFERENCES "competitors"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "lost_deals" ADD CONSTRAINT "FK_f060ba670757070c4594ef4e95c" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "lost_deal_lines" ADD CONSTRAINT "FK_2b7ab7309888e2f48af1d611ad7" FOREIGN KEY ("lostDealId") REFERENCES "lost_deals"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "market_prices" ADD CONSTRAINT "FK_c50fea2fd546e126f1cdd078225" FOREIGN KEY ("competitorId") REFERENCES "competitors"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "market_prices" ADD CONSTRAINT "FK_826690da52e8485db68373576cc" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "market_prices" ADD CONSTRAINT "FK_29b74cb8676e9eef1165eba6251" FOREIGN KEY ("lostDealId") REFERENCES "lost_deals"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "market_prices" ADD CONSTRAINT "FK_02573e0a339a6ceae36da5a2696" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "quotations" ADD CONSTRAINT "FK_cdd0816cc9e15320b5d478e202c" FOREIGN KEY ("competitorId") REFERENCES "competitors"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "quotation_events" ADD CONSTRAINT "FK_cbf9b9cd583b8e73cf88132b5b5" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "quotation_events" ADD CONSTRAINT "FK_b0af895df45a5b5523e367248f8" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "quotation_events" DROP CONSTRAINT "FK_b0af895df45a5b5523e367248f8"`);
        await queryRunner.query(`ALTER TABLE "quotation_events" DROP CONSTRAINT "FK_cbf9b9cd583b8e73cf88132b5b5"`);
        await queryRunner.query(`ALTER TABLE "quotations" DROP CONSTRAINT "FK_cdd0816cc9e15320b5d478e202c"`);
        await queryRunner.query(`ALTER TABLE "market_prices" DROP CONSTRAINT "FK_02573e0a339a6ceae36da5a2696"`);
        await queryRunner.query(`ALTER TABLE "market_prices" DROP CONSTRAINT "FK_29b74cb8676e9eef1165eba6251"`);
        await queryRunner.query(`ALTER TABLE "market_prices" DROP CONSTRAINT "FK_826690da52e8485db68373576cc"`);
        await queryRunner.query(`ALTER TABLE "market_prices" DROP CONSTRAINT "FK_c50fea2fd546e126f1cdd078225"`);
        await queryRunner.query(`ALTER TABLE "lost_deal_lines" DROP CONSTRAINT "FK_2b7ab7309888e2f48af1d611ad7"`);
        await queryRunner.query(`ALTER TABLE "lost_deals" DROP CONSTRAINT "FK_f060ba670757070c4594ef4e95c"`);
        await queryRunner.query(`ALTER TABLE "lost_deals" DROP CONSTRAINT "FK_10065e78b0910beb749ab027db0"`);
        await queryRunner.query(`ALTER TABLE "lost_deals" DROP CONSTRAINT "FK_40ba88ab2589ba5189f1ae9e9ee"`);
        await queryRunner.query(`ALTER TABLE "quotation_lines" DROP COLUMN "competitorPrice"`);
        await queryRunner.query(`ALTER TABLE "quotations" DROP COLUMN "competitorCreditDays"`);
        await queryRunner.query(`ALTER TABLE "quotations" DROP COLUMN "competitorId"`);
        await queryRunner.query(`ALTER TABLE "quotations" DROP COLUMN "lostReasonCode"`);
        await queryRunner.query(`ALTER TABLE "quotations" DROP COLUMN "lostAt"`);
        await queryRunner.query(`ALTER TABLE "quotations" DROP COLUMN "creditDays"`);
        await queryRunner.query(`ALTER TABLE "quotations" ADD "competitor" character varying(120)`);
        await queryRunner.query(`ALTER TABLE "quotations" ADD "competitorPrice" numeric(12,2)`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ae3ea97c4bdd7712274c62bcc7"`);
        await queryRunner.query(`DROP TABLE "quotation_events"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_88986956a51d5bc7b75a54c36e"`);
        await queryRunner.query(`DROP TABLE "market_prices"`);
        await queryRunner.query(`DROP TYPE "public"."market_prices_source_enum"`);
        await queryRunner.query(`DROP TABLE "lost_deal_lines"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9141e57d72bf496da972ade1bf"`);
        await queryRunner.query(`DROP TABLE "lost_deals"`);
        await queryRunner.query(`DROP TYPE "public"."lost_deals_reason_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_374f5a92c2408ee1eb52659af6"`);
        await queryRunner.query(`DROP TABLE "competitors"`);
    }

}

import type { MigrationInterface, QueryRunner } from "typeorm";

export class ProductCatalogue1795293848418 implements MigrationInterface {
    name = 'ProductCatalogue1795293848418'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "variant_zones" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "variantId" uuid NOT NULL, "zone" character varying(40) NOT NULL, "label" character varying(40) NOT NULL, "loadQty" numeric(12,3), CONSTRAINT "PK_b0ca942f36123943609f5901823" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_d28d3a8fec9e8b6d59c5a766ea" ON "variant_zones"  ("variantId", "zone", "label") `);
        await queryRunner.query(`ALTER TABLE "product_variants" ADD "erpName" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "product_variants" ADD CONSTRAINT "UQ_7760f0a2741a3ccb71cfcfb9aff" UNIQUE ("erpName")`);
        await queryRunner.query(`ALTER TABLE "product_variants" ADD "colors" text array NOT NULL DEFAULT '{}'`);
        await queryRunner.query(`ALTER TYPE "public"."product_variants_unit_enum" ADD VALUE 'GALLON'`);
        await queryRunner.query(`ALTER TYPE "public"."product_variants_unit_enum" ADD VALUE 'TRAILER'`);
        await queryRunner.query(`ALTER TABLE "product_variants" ALTER COLUMN "minQty" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "product_variants" ALTER COLUMN "minQty" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "variant_zones" ADD CONSTRAINT "FK_9642bd0b5d4a744f1aa29f9f803" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "variant_zones" DROP CONSTRAINT "FK_9642bd0b5d4a744f1aa29f9f803"`);
        await queryRunner.query(`ALTER TABLE "product_variants" ALTER COLUMN "minQty" SET DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "product_variants" ALTER COLUMN "minQty" SET NOT NULL`);
        await queryRunner.query(`CREATE TYPE "public"."product_variants_unit_enum_old" AS ENUM('TON', 'BAG', 'M3', 'PIECE', 'KG', 'METER')`);
        await queryRunner.query(`ALTER TABLE "product_variants" ALTER COLUMN "unit" TYPE "public"."product_variants_unit_enum_old" USING "unit"::"text"::"public"."product_variants_unit_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."product_variants_unit_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."product_variants_unit_enum_old" RENAME TO "product_variants_unit_enum"`);
        await queryRunner.query(`ALTER TABLE "product_variants" DROP COLUMN "colors"`);
        await queryRunner.query(`ALTER TABLE "product_variants" DROP CONSTRAINT "UQ_7760f0a2741a3ccb71cfcfb9aff"`);
        await queryRunner.query(`ALTER TABLE "product_variants" DROP COLUMN "erpName"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d28d3a8fec9e8b6d59c5a766ea"`);
        await queryRunner.query(`DROP TABLE "variant_zones"`);
    }

}

import type { MigrationInterface, QueryRunner } from "typeorm";

export class Init1795287032185 implements MigrationInterface {
    name = 'Init1795287032185'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."clients_status_enum" AS ENUM('ACTIVE', 'PROSPECT', 'INACTIVE')`);
        await queryRunner.query(`CREATE TABLE "clients" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "code" character varying(40), "name" character varying NOT NULL, "status" "public"."clients_status_enum" NOT NULL DEFAULT 'ACTIVE', "repId" uuid NOT NULL, "city" character varying(80), "address" character varying(255), "crNumber" character varying(20), "vatNumber" character varying(20), "paymentTermsDays" integer NOT NULL DEFAULT '0', "creditLimit" numeric(14,2) NOT NULL DEFAULT '0', "openingBalance" numeric(14,2) NOT NULL DEFAULT '0', "purchasingName" character varying(120), "purchasingPhone" character varying(32), "purchasingEmail" character varying(255), "notes" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_5b84bb456aa7fc9241c5d8277d0" UNIQUE ("code"), CONSTRAINT "PK_f1ab7cf3a5714dbc6bb4e1c28a4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_35b6ff8c7a67e33dba7db03556" ON "clients"  ("repId", "name") `);
        await queryRunner.query(`CREATE TABLE "brands" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying NOT NULL, "nameEn" character varying(120), CONSTRAINT "UQ_96db6bbbaa6f23cad26871339b6" UNIQUE ("name"), CONSTRAINT "PK_b0c437120b624da1034a81fc561" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying NOT NULL, "nameEn" character varying(120), "category" character varying(40) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_4c9fb58de893725258746385e16" UNIQUE ("name"), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."product_variants_unit_enum" AS ENUM('TON', 'BAG', 'M3', 'PIECE', 'KG', 'METER')`);
        await queryRunner.query(`CREATE TABLE "product_variants" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "productId" uuid NOT NULL, "brandId" uuid, "spec" character varying(60) NOT NULL DEFAULT '', "unit" "public"."product_variants_unit_enum" NOT NULL, "minQty" numeric(12,3) NOT NULL DEFAULT '0', "supplierName" character varying(120), "isActive" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_281e3f2c55652d6a22c0aa59fd7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_7ccdaed9718cd3451b3eb61824" ON "product_variants"  ("productId", "brandId", "spec") NULLS NOT DISTINCT `);
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('ADMIN', 'REP', 'CLIENT')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying NOT NULL, "email" character varying(255), "phone" character varying(32), "passwordHash" character varying NOT NULL, "role" "public"."users_role_enum" NOT NULL DEFAULT 'REP', "jobTitle" character varying(120), "clientId" uuid, "locale" character varying(2) NOT NULL DEFAULT 'ar', "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "UQ_a000cca60bcf04454e727699490" UNIQUE ("phone"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "clients" ADD CONSTRAINT "FK_750470d6587fa0beea7ff51e27f" FOREIGN KEY ("repId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "product_variants" ADD CONSTRAINT "FK_f515690c571a03400a9876600b5" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "product_variants" ADD CONSTRAINT "FK_d6253b69a6d9cf2afe0306bb9af" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "FK_6c3a73bbc9d8a8082816adc870e" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_6c3a73bbc9d8a8082816adc870e"`);
        await queryRunner.query(`ALTER TABLE "product_variants" DROP CONSTRAINT "FK_d6253b69a6d9cf2afe0306bb9af"`);
        await queryRunner.query(`ALTER TABLE "product_variants" DROP CONSTRAINT "FK_f515690c571a03400a9876600b5"`);
        await queryRunner.query(`ALTER TABLE "clients" DROP CONSTRAINT "FK_750470d6587fa0beea7ff51e27f"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7ccdaed9718cd3451b3eb61824"`);
        await queryRunner.query(`DROP TABLE "product_variants"`);
        await queryRunner.query(`DROP TYPE "public"."product_variants_unit_enum"`);
        await queryRunner.query(`DROP TABLE "products"`);
        await queryRunner.query(`DROP TABLE "brands"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_35b6ff8c7a67e33dba7db03556"`);
        await queryRunner.query(`DROP TABLE "clients"`);
        await queryRunner.query(`DROP TYPE "public"."clients_status_enum"`);
    }

}

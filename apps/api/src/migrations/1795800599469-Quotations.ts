import type { MigrationInterface, QueryRunner } from "typeorm";

export class Quotations1795800599469 implements MigrationInterface {
    name = 'Quotations1795800599469'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."quotations_status_enum" AS ENUM('DRAFT', 'SENT', 'ACCEPTED', 'LOST')`);
        await queryRunner.query(`CREATE TABLE "quotations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "number" character varying(60) NOT NULL, "clientId" uuid NOT NULL, "projectId" uuid, "date" date NOT NULL, "attn" character varying(120), "phone" character varying(40), "email" character varying(160), "reference" character varying(80), "status" "public"."quotations_status_enum" NOT NULL DEFAULT 'DRAFT', "vatRate" numeric(5,2) NOT NULL DEFAULT '15', "terms" text NOT NULL, "pdfName" character varying(120), "notes" text, "sentAt" TIMESTAMP WITH TIME ZONE, "acceptedAt" date, "lostReason" text, "competitor" character varying(120), "competitorPrice" numeric(12,2), "createdById" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_7f5e93568b20c949b3b4bac5717" UNIQUE ("number"), CONSTRAINT "PK_6c00eb8ba181f28c21ffba7ecb1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_5261a1d8433fff32c5b927d5ab" ON "quotations"  ("clientId", "date") `);
        await queryRunner.query(`CREATE TABLE "quotation_lines" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "quotationId" uuid NOT NULL, "position" integer NOT NULL DEFAULT '0', "name" character varying(200) NOT NULL, "variantIds" uuid array NOT NULL DEFAULT '{}', "unit" "public"."product_variants_unit_enum" NOT NULL, "qty" numeric(12,3) NOT NULL, "unitPrice" numeric(12,2) NOT NULL, CONSTRAINT "PK_facdcaf4d7c7974c5d9adb63c23" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "quotations" ADD CONSTRAINT "FK_f004dcdca146f7fc5428e57fb57" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "quotations" ADD CONSTRAINT "FK_728885fe8a8fbf9745aafdb0b72" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "quotation_lines" ADD CONSTRAINT "FK_3bcebd04377d4c558966f62067c" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "quotation_lines" DROP CONSTRAINT "FK_3bcebd04377d4c558966f62067c"`);
        await queryRunner.query(`ALTER TABLE "quotations" DROP CONSTRAINT "FK_728885fe8a8fbf9745aafdb0b72"`);
        await queryRunner.query(`ALTER TABLE "quotations" DROP CONSTRAINT "FK_f004dcdca146f7fc5428e57fb57"`);
        await queryRunner.query(`DROP TABLE "quotation_lines"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5261a1d8433fff32c5b927d5ab"`);
        await queryRunner.query(`DROP TABLE "quotations"`);
        await queryRunner.query(`DROP TYPE "public"."quotations_status_enum"`);
    }

}

import type { MigrationInterface, QueryRunner } from "typeorm";

export class Guarantees1795627395114 implements MigrationInterface {
    name = 'Guarantees1795627395114'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."client_guarantees_type_enum" AS ENUM('EPN', 'LC', 'LG', 'CHEQUE', 'NO_GUARANTEE')`);
        await queryRunner.query(`CREATE TYPE "public"."client_guarantees_status_enum" AS ENUM('ACTIVE', 'RETURNED', 'CONVERTED', 'BOUNCED', 'EXPIRED')`);
        await queryRunner.query(`CREATE TABLE "client_guarantees" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "clientId" uuid NOT NULL, "type" "public"."client_guarantees_type_enum" NOT NULL, "status" "public"."client_guarantees_status_enum" NOT NULL DEFAULT 'ACTIVE', "amount" numeric(14,2), "reference" character varying(80), "issuer" character varying(120), "date" date, "expiryDate" date, "fileId" uuid, "creditApprovedAmount" numeric(14,2), "approvedBy" character varying(120), "approvedAt" date, "approvalFileId" uuid, "paymentId" uuid, "replacedByGuaranteeId" uuid, "notes" text, "createdById" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "removedAt" TIMESTAMP WITH TIME ZONE, "removedReason" text, CONSTRAINT "PK_0605bfb46f36f0c3e529649cabd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_0cd14f895528d1264c19e2373b" ON "client_guarantees"  ("clientId", "status") `);
        // Guarantee cheques / LCs recorded as payments move to the client's guarantees.
        await queryRunner.query(`
            INSERT INTO "client_guarantees" ("clientId", "type", "status", "amount", "reference", "issuer", "date", "fileId",
                "creditApprovedAmount", "approvedBy", "approvedAt", "approvalFileId", "notes", "createdById", "createdAt",
                "removedAt", "removedReason")
            SELECT "clientId", (CASE WHEN method::text = 'LC' THEN 'LC' ELSE 'CHEQUE' END)::"public"."client_guarantees_type_enum",
                   (CASE status::text WHEN 'PENDING' THEN 'ACTIVE' WHEN 'RECEIVED' THEN 'CONVERTED' WHEN 'BOUNCED' THEN 'BOUNCED' ELSE 'RETURNED' END)::"public"."client_guarantees_status_enum",
                   amount, reference, bank, "dueDate", "fileId", "creditApprovedAmount", "approvedBy", "approvedAt",
                   "approvalFileId", notes, "createdById", "createdAt", "removedAt", "removedReason"
              FROM "payments" WHERE purpose = 'GUARANTEE' AND status <> 'RECEIVED'`);
        await queryRunner.query(`DELETE FROM "payments" WHERE purpose = 'GUARANTEE' AND status <> 'RECEIVED'`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "purpose"`);
        await queryRunner.query(`DROP TYPE "public"."payments_purpose_enum"`);
        await queryRunner.query(`ALTER TABLE "clients" ADD "overdueStopDays" integer`);
        await queryRunner.query(`ALTER TABLE "client_guarantees" ADD CONSTRAINT "FK_b73639c0754eb9c49834a76f2de" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "client_guarantees" DROP CONSTRAINT "FK_b73639c0754eb9c49834a76f2de"`);
        await queryRunner.query(`ALTER TABLE "clients" DROP COLUMN "overdueStopDays"`);
        await queryRunner.query(`CREATE TYPE "public"."payments_purpose_enum" AS ENUM('PAYMENT', 'GUARANTEE')`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "purpose" "public"."payments_purpose_enum" NOT NULL DEFAULT 'PAYMENT'`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0cd14f895528d1264c19e2373b"`);
        await queryRunner.query(`DROP TABLE "client_guarantees"`);
        await queryRunner.query(`DROP TYPE "public"."client_guarantees_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."client_guarantees_type_enum"`);
    }

}

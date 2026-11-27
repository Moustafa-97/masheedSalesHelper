import type { MigrationInterface, QueryRunner } from "typeorm";

export class ChequeApproval1795625784083 implements MigrationInterface {
    name = 'ChequeApproval1795625784083'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."payments_purpose_enum" AS ENUM('PAYMENT', 'GUARANTEE')`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "purpose" "public"."payments_purpose_enum" NOT NULL DEFAULT 'PAYMENT'`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "creditApprovedAmount" numeric(14,2)`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "approvedBy" character varying(120)`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "approvedAt" date`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "approvalFileId" uuid`);
        await queryRunner.query(`ALTER TYPE "public"."payments_status_enum" ADD VALUE 'RETURNED'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."payments_status_enum_old" AS ENUM('PENDING', 'RECEIVED', 'BOUNCED')`);
        await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "status" TYPE "public"."payments_status_enum_old" USING "status"::"text"::"public"."payments_status_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."payments_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."payments_status_enum_old" RENAME TO "payments_status_enum"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "approvalFileId"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "approvedAt"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "approvedBy"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "creditApprovedAmount"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "purpose"`);
        await queryRunner.query(`DROP TYPE "public"."payments_purpose_enum"`);
    }

}

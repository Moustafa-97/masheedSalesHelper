import type { MigrationInterface, QueryRunner } from "typeorm";

export class PaymentMethods1795625143093 implements MigrationInterface {
    name = 'PaymentMethods1795625143093'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."payments_status_enum" AS ENUM('PENDING', 'RECEIVED', 'BOUNCED')`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "status" "public"."payments_status_enum" NOT NULL DEFAULT 'RECEIVED'`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "dueDate" date`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "bank" character varying(80)`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "collectedDate" date`);
        // Transfers and cash recorded before this change were already received on their date.
        await queryRunner.query(`UPDATE "payments" SET "collectedDate" = "date"`);
        await queryRunner.query(`ALTER TYPE "public"."payments_method_enum" ADD VALUE 'CHEQUE'`);
        await queryRunner.query(`ALTER TYPE "public"."payments_method_enum" ADD VALUE 'LC'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."payments_method_enum_old" AS ENUM('TRANSFER', 'CASH')`);
        await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "method" TYPE "public"."payments_method_enum_old" USING "method"::"text"::"public"."payments_method_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."payments_method_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."payments_method_enum_old" RENAME TO "payments_method_enum"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "collectedDate"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "bank"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "dueDate"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "status"`);
        await queryRunner.query(`DROP TYPE "public"."payments_status_enum"`);
    }

}

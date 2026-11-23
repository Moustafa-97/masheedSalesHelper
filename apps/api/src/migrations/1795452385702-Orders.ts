import type { MigrationInterface, QueryRunner } from "typeorm";

export class Orders1795452385702 implements MigrationInterface {
    name = 'Orders1795452385702'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "files" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "storageKey" character varying(300) NOT NULL, "originalName" character varying(255) NOT NULL, "mimeType" character varying(120) NOT NULL, "size" integer NOT NULL, "uploadedById" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6c16b9093a142e0e7613b04a3d9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "client_projects" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "clientId" uuid NOT NULL, "name" character varying(160) NOT NULL, "mapsUrl" character varying(1000), "contacts" text, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_25cf83f0d86704a0363ddd713ca" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_8808cc72e957e1f190b32157ac" ON "client_projects"  ("clientId", "name") `);
        await queryRunner.query(`CREATE TYPE "public"."orders_status_enum" AS ENUM('NEW', 'SENT_TO_SUPPLY', 'SUPPLY_RECEIVED', 'AT_SUPPLIER', 'IN_TRANSIT', 'DELIVERED', 'INVOICED', 'CANCELLED')`);
        await queryRunner.query(`CREATE TABLE "orders" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "number" character varying(40) NOT NULL, "clientId" uuid NOT NULL, "projectId" uuid, "createdById" uuid NOT NULL, "orderDate" date NOT NULL, "status" "public"."orders_status_enum" NOT NULL DEFAULT 'NEW', "vatRate" numeric(5,2) NOT NULL DEFAULT '15', "notes" text, "cancelledAt" TIMESTAMP WITH TIME ZONE, "cancelReason" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_4e174e347d448617acdf98fef0d" UNIQUE ("number"), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e995b7aa0ef4ec44170aef5acd" ON "orders"  ("clientId", "orderDate") `);
        await queryRunner.query(`CREATE TABLE "order_lines" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "orderId" uuid NOT NULL, "variantId" uuid NOT NULL, "description" character varying(300) NOT NULL, "unit" "public"."product_variants_unit_enum" NOT NULL, "color" character varying(60), "qty" numeric(12,3) NOT NULL, "unitPrice" numeric(12,2) NOT NULL, "purchasePrice" numeric(12,2), "belowMinReason" text, "position" integer NOT NULL DEFAULT '0', "removedAt" TIMESTAMP WITH TIME ZONE, "removedReason" text, CONSTRAINT "PK_627dcd7f1d707de4df241b2da6b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."order_documents_type_enum" AS ENUM('PO', 'DELIVERY_NOTE', 'PURCHASE_INVOICE', 'SALES_INVOICE', 'OTHER')`);
        await queryRunner.query(`CREATE TABLE "order_documents" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "orderId" uuid NOT NULL, "fileId" uuid NOT NULL, "type" "public"."order_documents_type_enum" NOT NULL, "reference" character varying(80), "createdById" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "removedAt" TIMESTAMP WITH TIME ZONE, "removedReason" text, CONSTRAINT "PK_aeccb279d4128dec46b2d690c2a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "deliveries" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "orderId" uuid NOT NULL, "date" date NOT NULL, "reference" character varying(80), "documentId" uuid, "notes" text, "createdById" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "removedAt" TIMESTAMP WITH TIME ZONE, "removedReason" text, CONSTRAINT "PK_a6ef225c5c5f0974e503bfb731f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "delivery_lines" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "deliveryId" uuid NOT NULL, "orderLineId" uuid NOT NULL, "qty" numeric(12,3) NOT NULL, CONSTRAINT "PK_e124849dfb242b302ebe832f1c4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "sales_invoices" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "orderId" uuid NOT NULL, "number" character varying(60) NOT NULL, "date" date NOT NULL, "amount" numeric(14,2) NOT NULL, "documentId" uuid, "createdById" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "removedAt" TIMESTAMP WITH TIME ZONE, "removedReason" text, CONSTRAINT "PK_be0576afbf66c353a8a4435a45b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."payments_method_enum" AS ENUM('TRANSFER', 'CASH')`);
        await queryRunner.query(`CREATE TABLE "payments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "clientId" uuid NOT NULL, "orderId" uuid, "amount" numeric(14,2) NOT NULL, "date" date NOT NULL, "method" "public"."payments_method_enum" NOT NULL DEFAULT 'TRANSFER', "reference" character varying(80), "fileId" uuid, "notes" text, "createdById" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "removedAt" TIMESTAMP WITH TIME ZONE, "removedReason" text, CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d25d7ae87cfd17fd0d80693662" ON "payments"  ("clientId", "date") `);
        await queryRunner.query(`CREATE TABLE "order_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "orderId" uuid NOT NULL, "userId" uuid NOT NULL, "type" character varying(40) NOT NULL, "data" jsonb NOT NULL DEFAULT '{}', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cc1b82b0fcf1be577d9d7ecbf8b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_307480e6e5448fcce63c68d1a6" ON "order_events"  ("orderId", "createdAt") `);
        await queryRunner.query(`ALTER TABLE "users" ADD "supplyContactName" character varying(120)`);
        await queryRunner.query(`ALTER TABLE "users" ADD "supplyContactPhone" character varying(20)`);
        await queryRunner.query(`ALTER TABLE "client_projects" ADD CONSTRAINT "FK_53fd40a30c489eb4b6b027266ee" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_1457f286d91f271313fded23e53" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_00998b72e9ebf0f72c23e7b91d9" FOREIGN KEY ("projectId") REFERENCES "client_projects"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_39b1402eea81b07616277578fa5" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order_lines" ADD CONSTRAINT "FK_307e8091afc1a959953d06d5ad1" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order_lines" ADD CONSTRAINT "FK_209fca2928acde0eef8a7581822" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order_documents" ADD CONSTRAINT "FK_62082eec7cb7b391ce9329a4e5c" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order_documents" ADD CONSTRAINT "FK_23d06feb669898e36ae73f19df3" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "deliveries" ADD CONSTRAINT "FK_f7433e3639e213f901e22cf8640" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "delivery_lines" ADD CONSTRAINT "FK_f5eff4bb698163e1ab166990c06" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "delivery_lines" ADD CONSTRAINT "FK_6d085183ecba939a7e50e25efdb" FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sales_invoices" ADD CONSTRAINT "FK_fbfd95d107d20cced6e2e168bbf" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payments" ADD CONSTRAINT "FK_e7c2e95ccd4bd2068c70744dd65" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order_events" ADD CONSTRAINT "FK_74f8a596c01980f8e99f503c27b" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order_events" ADD CONSTRAINT "FK_742b9dca86792b2785811104abc" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "order_events" DROP CONSTRAINT "FK_742b9dca86792b2785811104abc"`);
        await queryRunner.query(`ALTER TABLE "order_events" DROP CONSTRAINT "FK_74f8a596c01980f8e99f503c27b"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP CONSTRAINT "FK_e7c2e95ccd4bd2068c70744dd65"`);
        await queryRunner.query(`ALTER TABLE "sales_invoices" DROP CONSTRAINT "FK_fbfd95d107d20cced6e2e168bbf"`);
        await queryRunner.query(`ALTER TABLE "delivery_lines" DROP CONSTRAINT "FK_6d085183ecba939a7e50e25efdb"`);
        await queryRunner.query(`ALTER TABLE "delivery_lines" DROP CONSTRAINT "FK_f5eff4bb698163e1ab166990c06"`);
        await queryRunner.query(`ALTER TABLE "deliveries" DROP CONSTRAINT "FK_f7433e3639e213f901e22cf8640"`);
        await queryRunner.query(`ALTER TABLE "order_documents" DROP CONSTRAINT "FK_23d06feb669898e36ae73f19df3"`);
        await queryRunner.query(`ALTER TABLE "order_documents" DROP CONSTRAINT "FK_62082eec7cb7b391ce9329a4e5c"`);
        await queryRunner.query(`ALTER TABLE "order_lines" DROP CONSTRAINT "FK_209fca2928acde0eef8a7581822"`);
        await queryRunner.query(`ALTER TABLE "order_lines" DROP CONSTRAINT "FK_307e8091afc1a959953d06d5ad1"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_39b1402eea81b07616277578fa5"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_00998b72e9ebf0f72c23e7b91d9"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_1457f286d91f271313fded23e53"`);
        await queryRunner.query(`ALTER TABLE "client_projects" DROP CONSTRAINT "FK_53fd40a30c489eb4b6b027266ee"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "supplyContactPhone"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "supplyContactName"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_307480e6e5448fcce63c68d1a6"`);
        await queryRunner.query(`DROP TABLE "order_events"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d25d7ae87cfd17fd0d80693662"`);
        await queryRunner.query(`DROP TABLE "payments"`);
        await queryRunner.query(`DROP TYPE "public"."payments_method_enum"`);
        await queryRunner.query(`DROP TABLE "sales_invoices"`);
        await queryRunner.query(`DROP TABLE "delivery_lines"`);
        await queryRunner.query(`DROP TABLE "deliveries"`);
        await queryRunner.query(`DROP TABLE "order_documents"`);
        await queryRunner.query(`DROP TYPE "public"."order_documents_type_enum"`);
        await queryRunner.query(`DROP TABLE "order_lines"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e995b7aa0ef4ec44170aef5acd"`);
        await queryRunner.query(`DROP TABLE "orders"`);
        await queryRunner.query(`DROP TYPE "public"."orders_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8808cc72e957e1f190b32157ac"`);
        await queryRunner.query(`DROP TABLE "client_projects"`);
        await queryRunner.query(`DROP TABLE "files"`);
    }

}

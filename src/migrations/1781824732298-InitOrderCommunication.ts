import { MigrationInterface, QueryRunner } from "typeorm";

export class InitOrderCommunication1781824732298 implements MigrationInterface {
    name = 'InitOrderCommunication1781824732298'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TABLE "processed_events" ("idempotency_key" character varying NOT NULL, "routing_key" character varying NOT NULL, "processed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_3895859eda59a0f80aa8ada303f" PRIMARY KEY ("idempotency_key"))`);
        await queryRunner.query(`CREATE TABLE "conversations" ("id" uuid NOT NULL, "order_id" uuid NOT NULL, "store_id" uuid NOT NULL, "customer_id" uuid NOT NULL, "vendor_id" uuid NOT NULL, "status" character varying(16) NOT NULL, "last_message_at" TIMESTAMP WITH TIME ZONE, "last_message_preview" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_ee34f4f7ced4ec8681f26bf04ef" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_f8f897401fd91b6b2e8534c226" ON "conversations" ("order_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_6cdc32f719992a332240bffef0" ON "conversations" ("store_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_c9f0434c15cacf894e996f6908" ON "conversations" ("customer_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_6bdac49ab0bb6cbe6e4c240cc5" ON "conversations" ("vendor_id") `);
        await queryRunner.query(`CREATE TABLE "participants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "conversation_id" uuid NOT NULL, "user_id" uuid NOT NULL, "role" character varying(16) NOT NULL, "joined_at" TIMESTAMP WITH TIME ZONE NOT NULL, "left_at" TIMESTAMP WITH TIME ZONE, "last_read_at" TIMESTAMP WITH TIME ZONE, "unread_count" integer NOT NULL DEFAULT '0', "typing" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_1cda06c31eec1c95b3365a0283f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_709250a1408c4f7e62085fbc74" ON "participants" ("conversation_id", "user_id") `);
        await queryRunner.query(`CREATE TABLE "outbox_events" ("id" uuid NOT NULL, "routing_key" character varying NOT NULL, "payload" jsonb NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'PENDING', "retry_count" integer NOT NULL DEFAULT '0', "last_error" text, "published_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6689a16c00d09b8089f6237f1d2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_733fafe6b0ec20ec7c93fdbbca" ON "outbox_events" ("status") `);
        await queryRunner.query(`CREATE TABLE "order_items" ("id" uuid NOT NULL, "order_id" uuid NOT NULL, "product_id" uuid NOT NULL, "name" character varying NOT NULL, "description" text, "image_url" text, "unit_price" bigint NOT NULL, "quantity" integer NOT NULL, "total_amount" bigint NOT NULL, CONSTRAINT "PK_005269d8574e6fac0493715c308" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "order_status_history" ("id" uuid NOT NULL, "order_id" uuid NOT NULL, "from_status" character varying(32), "to_status" character varying(32) NOT NULL, "actor_type" character varying(16) NOT NULL, "actor_id" character varying, "reason" text, "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_e6c66d853f155531985fc4f6ec8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "order_ratings" ("id" uuid NOT NULL, "order_id" uuid NOT NULL, "customer_id" uuid NOT NULL, "score" integer NOT NULL, "comment" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "UQ_ac2ea4d30e34d7bb72afd11cea2" UNIQUE ("order_id"), CONSTRAINT "REL_ac2ea4d30e34d7bb72afd11cea" UNIQUE ("order_id"), CONSTRAINT "PK_6d707a3d524f0038d682da8d9ee" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "orders" ("id" uuid NOT NULL, "order_number" character varying NOT NULL, "customer_id" uuid NOT NULL, "store_id" uuid NOT NULL, "store_name" character varying NOT NULL, "status" character varying(32) NOT NULL, "payment_method" character varying(16) NOT NULL, "delivery_method" character varying(16) NOT NULL, "currency" character varying(8) NOT NULL, "source" character varying(16) NOT NULL, "notes" text, "subtotal_amount" bigint NOT NULL, "discount_amount" bigint NOT NULL, "total_amount" bigint NOT NULL, "pickup_expires_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "cancelled_at" TIMESTAMP WITH TIME ZONE, "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_75eba1c6b1a66b09f2a97e6927b" UNIQUE ("order_number"), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_772d0ce0473ac2ccfa26060dbe" ON "orders" ("customer_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_b7a7bb813431fc7cd73cced000" ON "orders" ("store_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_775c9f06fc27ae3ff8fb26f2c4" ON "orders" ("status") `);
        await queryRunner.query(`CREATE TABLE "messages" ("id" uuid NOT NULL, "conversation_id" uuid NOT NULL, "sender_id" uuid NOT NULL, "sender_role" character varying(16) NOT NULL, "content" text NOT NULL, "message_type" character varying(16) NOT NULL, "status" character varying(16) NOT NULL, "read_statuses" jsonb NOT NULL DEFAULT '[]'::jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_18325f38ae6de43878487eff986" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3bc55a7c3f9ed54b520bb5cfe2" ON "messages" ("conversation_id") `);
        await queryRunner.query(`ALTER TABLE "participants" ADD CONSTRAINT "FK_de8978490834e2e9cb3c3fc8066" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order_items" ADD CONSTRAINT "FK_145532db85752b29c57d2b7b1f1" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order_status_history" ADD CONSTRAINT "FK_1ca7d5228cf9dc589b60243933c" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order_ratings" ADD CONSTRAINT "FK_ac2ea4d30e34d7bb72afd11cea2" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "order_ratings" DROP CONSTRAINT "FK_ac2ea4d30e34d7bb72afd11cea2"`);
        await queryRunner.query(`ALTER TABLE "order_status_history" DROP CONSTRAINT "FK_1ca7d5228cf9dc589b60243933c"`);
        await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "FK_145532db85752b29c57d2b7b1f1"`);
        await queryRunner.query(`ALTER TABLE "participants" DROP CONSTRAINT "FK_de8978490834e2e9cb3c3fc8066"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3bc55a7c3f9ed54b520bb5cfe2"`);
        await queryRunner.query(`DROP TABLE "messages"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_775c9f06fc27ae3ff8fb26f2c4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b7a7bb813431fc7cd73cced000"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_772d0ce0473ac2ccfa26060dbe"`);
        await queryRunner.query(`DROP TABLE "orders"`);
        await queryRunner.query(`DROP TABLE "order_ratings"`);
        await queryRunner.query(`DROP TABLE "order_status_history"`);
        await queryRunner.query(`DROP TABLE "order_items"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_733fafe6b0ec20ec7c93fdbbca"`);
        await queryRunner.query(`DROP TABLE "outbox_events"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_709250a1408c4f7e62085fbc74"`);
        await queryRunner.query(`DROP TABLE "participants"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6bdac49ab0bb6cbe6e4c240cc5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c9f0434c15cacf894e996f6908"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6cdc32f719992a332240bffef0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f8f897401fd91b6b2e8534c226"`);
        await queryRunner.query(`DROP TABLE "conversations"`);
        await queryRunner.query(`DROP TABLE "processed_events"`);
    }

}

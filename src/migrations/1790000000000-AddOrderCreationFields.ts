import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Campos para cerrar gaps de creación de pedido:
 * - orders.idempotency_key (+ índice único): idempotencia del request de creación.
 * - orders.scheduled_pickup_at: hora de recogida programada por el comprador.
 * - order_items.notes: observación del comprador por línea (ej. "sin cebolla").
 */
export class AddOrderCreationFields1790000000000 implements MigrationInterface {
    name = 'AddOrderCreationFields1790000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "orders" ADD COLUMN "idempotency_key" character varying(128)`);
        await queryRunner.query(`ALTER TABLE "orders" ADD COLUMN "scheduled_pickup_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_orders_idempotency_key" ON "orders" ("idempotency_key")`);
        await queryRunner.query(`ALTER TABLE "order_items" ADD COLUMN "notes" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "order_items" DROP COLUMN "notes"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_orders_idempotency_key"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "scheduled_pickup_at"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "idempotency_key"`);
    }
}

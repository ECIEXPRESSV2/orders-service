import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * orders.pending_return_*: devolución cotizada por products mientras el pedido espera
 * aprobación de un admin (status RETURN_PENDING_APPROVAL, post-recogida). Toda devolución
 * solicitada después de que el pedido fue recogido (DELIVERED o sobre un pedido ya
 * PARTIALLY_RETURNED) pasa por esta cola en vez de auto-aplicarse: el admin necesita
 * verificar evidencia (fotos, motivo) antes de mover dinero. `pending_return_from_status`
 * guarda el estado de origen para restaurarlo si el admin rechaza la devolución.
 */
export class AddPendingReturnFieldsToOrders1797000000000 implements MigrationInterface {
    name = 'AddPendingReturnFieldsToOrders1797000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pending_return_amount" bigint`);
        await queryRunner.query(`ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pending_return_full" boolean`);
        await queryRunner.query(`ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pending_return_from_status" varchar(32)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "pending_return_from_status"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "pending_return_full"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "pending_return_amount"`);
    }
}

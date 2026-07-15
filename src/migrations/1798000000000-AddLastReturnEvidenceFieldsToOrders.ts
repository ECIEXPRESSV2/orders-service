import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * orders.last_return_*: motivo + carpeta de evidencia (fotos) de la ÚLTIMA solicitud de
 * devolución (`POST /orders/:id/returns`). Sobreviven hasta que `applyReturnPriced` arma el
 * mensaje de chat de la devolución pendiente de aprobación (RETURN_PENDING_APPROVAL); una
 * nueva solicitud los sobreescribe. `last_return_refund_id` es el nombre de carpeta
 * `<orderId>/refunds/<refundId>/` en el blob privado compartido `orders` (vacío si el
 * comprador no adjuntó fotos).
 */
export class AddLastReturnEvidenceFieldsToOrders1798000000000 implements MigrationInterface {
    name = 'AddLastReturnEvidenceFieldsToOrders1798000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "last_return_reason" text`);
        await queryRunner.query(`ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "last_return_refund_id" varchar(64)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "last_return_refund_id"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "last_return_reason"`);
    }
}

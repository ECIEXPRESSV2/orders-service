import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * orders.stock_reserved: bandera que indica que products-service ya confirmó la
 * reserva de stock de TODAS las líneas del pedido (evento
 * `product.inventory.reservation_confirmed`).
 *
 * La usa la confirmación de pedidos DIGITALES (wallet/tarjeta): a diferencia del
 * efectivo (Option C, que confirma directo con la reserva), un pedido digital solo
 * pasa a CONFIRMED cuando se cumplen AMBAS condiciones —pago aprobado Y stock
 * reservado—. Como los eventos `financial.payment.processed` y
 * `product.inventory.reservation_confirmed` llegan sin orden garantizado, se
 * persiste esta señal para no depender de cuál llegue primero. Cierra la sobreventa
 * en pedidos digitales (antes el pago confirmaba la orden sin mirar el stock).
 */
export class AddStockReservedToOrders1795000000000 implements MigrationInterface {
    name = 'AddStockReservedToOrders1795000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "stock_reserved" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "stock_reserved"`);
    }
}

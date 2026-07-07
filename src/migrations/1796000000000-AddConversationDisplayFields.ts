import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Identidad visual del chat, tomada de identity-service (best-effort) al confirmarse
 * el pedido:
 * - conversations.store_name / store_logo_url: para que el cliente vea nombre+logo
 *   de la tienda en su lista de chats.
 * - conversations.customer_name / customer_avatar_url: para que el vendedor vea
 *   nombre+foto del cliente que le escribe, en vez del nombre de su propia tienda
 *   repetido en cada fila.
 */
export class AddConversationDisplayFields1796000000000 implements MigrationInterface {
    name = 'AddConversationDisplayFields1796000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "store_name" character varying(200)`);
        await queryRunner.query(`ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "store_logo_url" text`);
        await queryRunner.query(`ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "customer_name" character varying(200)`);
        await queryRunner.query(`ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "customer_avatar_url" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN IF EXISTS "customer_avatar_url"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN IF EXISTS "customer_name"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN IF EXISTS "store_logo_url"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN IF EXISTS "store_name"`);
    }
}

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { ProductItemInput, ProductsPort, ValidatedItem } from '../../application/ports/products.port';

/**
 * Implementación MOCK de ProductsPort. products-service todavía no expone un
 * endpoint de productos/precios, así que confiamos en los datos del cliente y
 * solo validamos invariantes básicas. Reemplazable por ProductsHttpClient
 * cuando exista el endpoint (flag USE_PRODUCTS_MOCK=false).
 */
@Injectable()
export class ProductsMockClient implements ProductsPort {
  private readonly logger = new Logger(ProductsMockClient.name);

  async validateItems(storeId: string, items: ProductItemInput[]): Promise<ValidatedItem[]> {
    this.logger.debug(`[MOCK] Validando ${items.length} ítem(s) de la tienda ${storeId}`);
    if (!items.length) {
      throw new BadRequestException('At least one item is required');
    }
    for (const item of items) {
      if (item.quantity < 1) {
        throw new BadRequestException(`Cantidad inválida para el producto ${item.productId}`);
      }
      if (item.unitPrice < 0) {
        throw new BadRequestException(`Precio inválido para el producto ${item.productId}`);
      }
    }
    return items.map((item) => ({ ...item }));
  }
}

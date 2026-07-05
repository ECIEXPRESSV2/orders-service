import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  ProductItemInput,
  ProductsPort,
  QuotedItem,
  ValidatedItem,
} from '../../application/ports/products.port';

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

  async quoteItems(storeId: string, items: ProductItemInput[]): Promise<QuotedItem[]> {
    this.logger.debug(`[MOCK] Cotizando ${items.length} ítem(s) de la tienda ${storeId}`);
    // Sin catálogo real: confiamos en el precio del cliente y asumimos stock disponible.
    return items.map((item) => ({
      productId: item.productId,
      name: item.name,
      imageUrl: item.imageUrl,
      sku: undefined,
      listUnitPrice: item.unitPrice,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      totalAmount: item.unitPrice * item.quantity,
      available: item.quantity,
      hasStock: true,
    }));
  }
}

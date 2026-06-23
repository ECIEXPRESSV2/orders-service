import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import type { ProductItemInput, ProductsPort, ValidatedItem } from '../../application/ports/products.port';

/**
 * Cliente real hacia products-service. ⚠️ Pendiente: products-service aún no
 * expone GET /products. Cuando exista, este cliente valida que cada producto
 * pertenezca a la tienda, esté disponible y usa el precio AUTORITATIVO del
 * catálogo (no el del cliente). Se activa con USE_PRODUCTS_MOCK=false.
 *
 * Contrato esperado de products-service:
 *   GET /products?storeId={uuid}&ids=id1,id2
 *   -> [{ id, storeId, name, price (centavos COP), isAvailable, stock }]
 */
@Injectable()
export class ProductsHttpClient implements ProductsPort {
  private readonly logger = new Logger(ProductsHttpClient.name);

  private get baseUrl(): string {
    return (process.env.PRODUCTS_SERVICE_URL ?? 'http://localhost:3002').replace(/\/$/, '');
  }

  async validateItems(storeId: string, items: ProductItemInput[]): Promise<ValidatedItem[]> {
    const ids = items.map((item) => item.productId).join(',');
    const { data } = await axios.get(`${this.baseUrl}/products`, {
      params: { storeId, ids },
      timeout: 6000,
    });
    const catalog = new Map<string, { name: string; price: number; isAvailable: boolean; stock?: number }>(
      (data as Array<{ id: string; name: string; price: number; isAvailable: boolean; stock?: number }>).map((p) => [
        p.id,
        { name: p.name, price: p.price, isAvailable: p.isAvailable, stock: p.stock },
      ]),
    );

    return items.map((item) => {
      const product = catalog.get(item.productId);
      if (!product || !product.isAvailable) {
        throw new BadRequestException(`Producto ${item.productId} no disponible en la tienda ${storeId}`);
      }
      if (product.stock !== undefined && product.stock < item.quantity) {
        throw new BadRequestException(`Stock insuficiente para el producto ${item.productId}`);
      }
      return {
        productId: item.productId,
        name: product.name ?? item.name,
        description: item.description,
        imageUrl: item.imageUrl,
        notes: item.notes,
        unitPrice: product.price, // precio autoritativo del catálogo
        quantity: item.quantity,
      };
    });
  }
}

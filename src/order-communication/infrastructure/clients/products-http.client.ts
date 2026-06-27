import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import type { ProductItemInput, ProductsPort, ValidatedItem } from '../../application/ports/products.port';

/** Shape real de `GET /products` en products-service (ver ProductWithPricingDto). */
interface CatalogProduct {
  id: string;
  name: string;
  price: string; // decimal COP, ej. "4500.00" — NO centavos
  effectivePrice?: number; // COP con promoción aplicada, si la hay (mismo valor que price si no)
  isActive: boolean;
  stock: number;
  reservedStock: number;
}

/**
 * Cliente real hacia products-service: valida que cada producto pertenezca a la
 * tienda, esté activo y tenga stock disponible (stock - reservedStock), y usa el
 * precio AUTORITATIVO del catálogo —con la promoción ya aplicada si existe—, no
 * el que mande el cliente. Se activa con USE_PRODUCTS_MOCK=false.
 */
@Injectable()
export class ProductsHttpClient implements ProductsPort {
  private readonly logger = new Logger(ProductsHttpClient.name);

  private get baseUrl(): string {
    return (process.env.PRODUCTS_SERVICE_URL ?? 'http://localhost:3002').replace(/\/$/, '');
  }

  async validateItems(storeId: string, items: ProductItemInput[]): Promise<ValidatedItem[]> {
    const { data } = await axios.get<CatalogProduct[]>(`${this.baseUrl}/products`, {
      params: { storeId },
      timeout: 6000,
      // products-service exige x-user-id en todas sus rutas (GatewayAuthGuard).
      // Esta es una llamada servicio-a-servicio sin gateway de por medio, así que
      // nos identificamos como tal; GET /products no exige ningún rol.
      headers: { 'x-user-id': 'orders-service' },
    });
    const catalog = new Map(data.map((p) => [p.id, p]));

    return items.map((item) => {
      const product = catalog.get(item.productId);
      if (!product || !product.isActive) {
        throw new BadRequestException(`Producto ${item.productId} no disponible en la tienda ${storeId}`);
      }
      const available = product.stock - product.reservedStock;
      if (available < item.quantity) {
        throw new BadRequestException(`Stock insuficiente para el producto ${item.productId}`);
      }
      const priceCop = product.effectivePrice ?? parseFloat(product.price);
      return {
        productId: item.productId,
        name: product.name ?? item.name,
        description: item.description,
        imageUrl: item.imageUrl,
        notes: item.notes,
        unitPrice: Math.round(priceCop * 100), // centavos COP, como espera orders-service
        quantity: item.quantity,
      };
    });
  }
}

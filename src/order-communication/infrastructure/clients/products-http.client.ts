import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import type {
  ProductItemInput,
  ProductsPort,
  QuotedItem,
  ValidatedItem,
} from '../../application/ports/products.port';

/** Shape real de `GET /products` en products-service (ver ProductWithPricingDto). */
interface CatalogProduct {
  id: string;
  name: string;
  sku?: string | null;
  imageUrl?: string | null;
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

  /**
   * Trae el catálogo de la tienda con precios (effectivePrice/promoción). Llamar sin
   * `search`/`categoryId` es lo que activa `findAllWithPricing` en products-service.
   *
   * La lista vive en la RAÍZ del servicio (`GET /?storeId=`): el controller de products es
   * `@Controller('')` sin prefijo global; el `/products` que se ve desde el front lo añade el
   * gateway. Como esta es una llamada servicio-a-servicio DIRECTA (PRODUCTS_SERVICE_URL apunta al
   * servicio, no al gateway), pegamos a la raíz.
   */
  private async fetchCatalog(storeId: string): Promise<Map<string, CatalogProduct>> {
    const { data } = await axios.get<CatalogProduct[]>(`${this.baseUrl}/`, {
      params: { storeId },
      timeout: 6000,
      // products-service exige x-user-id en todas sus rutas (GatewayAuthGuard).
      // Esta es una llamada servicio-a-servicio sin gateway de por medio, así que
      // nos identificamos como tal; la lista no exige ningún rol.
      headers: { 'x-user-id': 'orders-service' },
    });
    return new Map(data.map((p) => [p.id, p]));
  }

  async validateItems(storeId: string, items: ProductItemInput[]): Promise<ValidatedItem[]> {
    const catalog = await this.fetchCatalog(storeId);

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

  async quoteItems(storeId: string, items: ProductItemInput[]): Promise<QuotedItem[]> {
    const catalog = await this.fetchCatalog(storeId);

    return items.map((item) => {
      const product = catalog.get(item.productId);
      // Producto ausente/inactivo: no se puede cotizar → línea sin stock ni precio, para que
      // el modal la marque como no disponible en vez de romper toda la cotización.
      if (!product || !product.isActive) {
        return {
          productId: item.productId,
          name: item.name,
          imageUrl: item.imageUrl,
          sku: undefined,
          listUnitPrice: 0,
          unitPrice: 0,
          quantity: item.quantity,
          totalAmount: 0,
          available: 0,
          hasStock: false,
        };
      }
      const listUnitPrice = Math.round(parseFloat(product.price) * 100);
      const unitPrice = Math.round((product.effectivePrice ?? parseFloat(product.price)) * 100);
      const available = Math.max(0, product.stock - product.reservedStock);
      return {
        productId: item.productId,
        name: product.name ?? item.name,
        imageUrl: product.imageUrl ?? item.imageUrl,
        sku: product.sku ?? undefined,
        listUnitPrice,
        unitPrice,
        quantity: item.quantity,
        totalAmount: unitPrice * item.quantity,
        available,
        hasStock: available >= item.quantity,
      };
    });
  }
}

export interface ValidatedItem {
  productId: string;
  name: string;
  description?: string;
  imageUrl?: string;
  /** Precio unitario autoritativo en centavos COP. */
  unitPrice: number;
  quantity: number;
}

export interface ProductItemInput {
  productId: string;
  name: string;
  description?: string;
  imageUrl?: string;
  unitPrice: number;
  quantity: number;
}

/**
 * Puerto hacia products-service para validar productos, precios y stock de una
 * tienda al crear un pedido. Devuelve los ítems con el precio autoritativo.
 */
export interface ProductsPort {
  validateItems(storeId: string, items: ProductItemInput[]): Promise<ValidatedItem[]>;
}

export const PRODUCTS_PORT = Symbol('PRODUCTS_PORT');

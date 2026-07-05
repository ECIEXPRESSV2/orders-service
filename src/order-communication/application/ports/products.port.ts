export interface ValidatedItem {
  productId: string;
  name: string;
  description?: string;
  imageUrl?: string;
  /** Observación del comprador para la línea (passthrough; products no la altera). */
  notes?: string;
  /** Precio unitario autoritativo en centavos COP. */
  unitPrice: number;
  quantity: number;
}

export interface ProductItemInput {
  productId: string;
  name: string;
  description?: string;
  imageUrl?: string;
  notes?: string;
  unitPrice: number;
  quantity: number;
}

/**
 * Ítem cotizado para el carrito (paso "Confirmar" → factura). A diferencia de
 * `validateItems`, NO lanza si falta stock: reporta la disponibilidad por línea para
 * que el modal de factura la muestre y el front decida si deja pagar. Trae el precio
 * de lista y el precio con promoción para poder mostrar el descuento.
 */
export interface QuotedItem {
  productId: string;
  name: string;
  imageUrl?: string;
  sku?: string;
  /** Precio unitario de lista en centavos COP (sin promoción). */
  listUnitPrice: number;
  /** Precio unitario con la mejor promoción aplicada, en centavos COP. */
  unitPrice: number;
  quantity: number;
  /** unitPrice * quantity, en centavos COP. */
  totalAmount: number;
  /** Unidades disponibles para vender (stock físico − reservado). */
  available: number;
  /** available >= quantity. */
  hasStock: boolean;
}

/**
 * Puerto hacia products-service para validar productos, precios y stock de una
 * tienda al crear un pedido. Devuelve los ítems con el precio autoritativo.
 */
export interface ProductsPort {
  validateItems(storeId: string, items: ProductItemInput[]): Promise<ValidatedItem[]>;
  /**
   * Cotiza el carrito de forma SÍNCRONA (precio autoritativo con promociones) y reporta
   * la disponibilidad de stock por línea SIN lanzar. Usado por el paso "Confirmar" antes
   * de mostrar la factura y habilitar el pago.
   */
  quoteItems(storeId: string, items: ProductItemInput[]): Promise<QuotedItem[]>;
}

export const PRODUCTS_PORT = Symbol('PRODUCTS_PORT');

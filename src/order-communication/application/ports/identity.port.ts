export interface StoreAvailability {
  available: boolean;
  reason?: string;
}

/**
 * Puerto hacia identity-service para validar datos necesarios al crear un pedido
 * (disponibilidad de la tienda). La validación del comprador la hace el guard.
 */
export interface IdentityPort {
  getStoreAvailability(storeId: string, pickupAt?: string): Promise<StoreAvailability>;
  /**
   * Devuelve el `userId` del vendedor real de la tienda (primer staff activo) para
   * asociarlo a la conversación del pedido. `null` si la tienda no tiene staff o si
   * identity no responde, en cuyo caso el llamador cae al `storeId` como aproximación.
   */
  getStoreVendorId(storeId: string): Promise<string | null>;
}

export const IDENTITY_PORT = Symbol('IDENTITY_PORT');

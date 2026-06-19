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
}

export const IDENTITY_PORT = Symbol('IDENTITY_PORT');

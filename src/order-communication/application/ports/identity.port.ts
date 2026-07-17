export interface StoreAvailability {
  available: boolean;
  reason?: string;
}

export interface StoreDisplay {
  name: string;
  logoUrl: string | null;
}

export interface UserDisplay {
  fullName: string;
  avatarUrl: string | null;
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
  /**
   * Devuelve los `userId` de TODO el staff activo de la tienda (no solo el primero). Se usa
   * para notificar en tiempo real (WebSocket) a cualquier miembro del staff, no solo al
   * `vendorId` fijado al crear la conversación -- igual que `isStoreStaff` ya permite que
   * cualquiera de ellos acceda al chat, no solo ese primero. `[]` si identity no responde.
   */
  getStoreStaffIds(storeId: string): Promise<string[]>;
  /**
   * Indica si `userId` es staff activo (o dueño) de `storeId`. Base del control de acceso
   * del chat: cualquier miembro del staff de la tienda puede ver/responder sus chats, no
   * solo el `vendorId` fijado al crear la conversación. `false` (no `true`) si identity no
   * responde: ante la duda, no se concede acceso.
   */
  isStoreStaff(storeId: string, userId: string): Promise<boolean>;
  /** Nombre + logo de la tienda, para mostrarlos en el chat del lado del cliente. */
  getStoreDisplay(storeId: string): Promise<StoreDisplay | null>;
  /** Nombre + avatar del usuario, para mostrarlos en el chat del lado del vendedor. */
  getUserDisplay(userId: string): Promise<UserDisplay | null>;
}

export const IDENTITY_PORT = Symbol('IDENTITY_PORT');

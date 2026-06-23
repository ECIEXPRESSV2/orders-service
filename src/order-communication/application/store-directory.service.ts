import { Injectable, Logger } from '@nestjs/common';
import type { IncomingStoreStatus } from '../infrastructure/messaging/event-contracts';

/**
 * Proyección local (en memoria) del estado de las tiendas, alimentada por el evento
 * `identity.store.status_changed`. Permite a orders bloquear pedidos nuevos sin depender
 * de una llamada síncrona a identity en cada operación.
 *
 * Es una caché best-effort: si orders se reinicia, queda vacía y el chequeo síncrono
 * (`IdentityPort.getStoreAvailability`) sigue siendo el respaldo autoritativo. Por eso
 * solo bloqueamos cuando la caché afirma que la tienda está cerrada; si no sabemos nada,
 * dejamos pasar y que decida el chequeo síncrono.
 */
@Injectable()
export class StoreDirectoryService {
  private readonly logger = new Logger(StoreDirectoryService.name);
  private readonly statusByStore = new Map<string, IncomingStoreStatus>();

  /** Aplica un cambio de estado recibido de identity. */
  applyStatusChanged(storeId: string, newStatus: IncomingStoreStatus, reason?: string): void {
    if (!storeId || !newStatus) return;
    this.statusByStore.set(storeId, newStatus);
    this.logger.log(
      `Tienda ${storeId} -> ${newStatus}${reason ? ` (${reason})` : ''} (proyección local actualizada)`,
    );
  }

  /**
   * Indica si la caché conoce que la tienda está cerrada. Devuelve `blocked: false`
   * cuando no hay información local (deja la decisión final al chequeo síncrono).
   */
  isBlocked(storeId: string): { blocked: boolean; reason?: string } {
    const status = this.statusByStore.get(storeId);
    if (status === 'CLOSED') return { blocked: true, reason: 'La tienda está cerrada' };
    if (status === 'TEMPORARILY_CLOSED') return { blocked: true, reason: 'La tienda está cerrada temporalmente' };
    return { blocked: false };
  }
}

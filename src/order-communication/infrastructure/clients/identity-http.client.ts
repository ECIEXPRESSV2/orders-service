import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import type { IdentityPort, StoreAvailability } from '../../application/ports/identity.port';

/**
 * Cliente real hacia identity-service. Si identity no responde, NO bloquea la
 * creación del pedido (degradación elegante): se asume disponible y se registra
 * una advertencia, evitando acoplar la disponibilidad de Order a otro servicio.
 */
@Injectable()
export class IdentityHttpClient implements IdentityPort {
  private readonly logger = new Logger(IdentityHttpClient.name);

  private get baseUrl(): string {
    return (process.env.IDENTITY_SERVICE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
  }

  async getStoreAvailability(storeId: string, pickupAt?: string): Promise<StoreAvailability> {
    try {
      const query = pickupAt ? `?pickupAt=${encodeURIComponent(pickupAt)}` : '';
      const { data } = await axios.get(
        `${this.baseUrl}/internal/stores/${storeId}/availability${query}`,
        { timeout: 6000 },
      );
      return {
        available: data.available !== false,
        reason: data.reason ?? data.closureReason,
      };
    } catch (error) {
      this.logger.warn(
        `No se pudo verificar disponibilidad de la tienda ${storeId} en identity: ${(error as Error).message}. Se asume disponible.`,
      );
      return { available: true };
    }
  }

  async getStoreVendorId(storeId: string): Promise<string | null> {
    try {
      const { data } = await axios.get<Array<{ userId?: string }>>(
        `${this.baseUrl}/internal/stores/${storeId}/staff`,
        { timeout: 6000 },
      );
      // El primer staff activo es el vendedor que atiende la conversación del pedido.
      return data?.find((member) => member.userId)?.userId ?? null;
    } catch (error) {
      this.logger.warn(
        `No se pudo resolver el vendedor de la tienda ${storeId} en identity: ${(error as Error).message}. Se usará el storeId como aproximación.`,
      );
      return null;
    }
  }
}

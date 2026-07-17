import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import type { IdentityPort, StoreAvailability, StoreDisplay, UserDisplay } from '../../application/ports/identity.port';

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

  async getStoreStaffIds(storeId: string): Promise<string[]> {
    try {
      const { data } = await axios.get<Array<{ userId?: string }>>(
        `${this.baseUrl}/internal/stores/${storeId}/staff`,
        { timeout: 6000 },
      );
      return (data ?? []).map((member) => member.userId).filter((id): id is string => !!id);
    } catch (error) {
      this.logger.warn(
        `No se pudo listar el staff de la tienda ${storeId} en identity: ${(error as Error).message}.`,
      );
      return [];
    }
  }

  async isStoreStaff(storeId: string, userId: string): Promise<boolean> {
    try {
      const { data } = await axios.get<Array<{ userId?: string }>>(
        `${this.baseUrl}/internal/stores/${storeId}/staff`,
        { timeout: 6000 },
      );
      return data?.some((member) => member.userId === userId) ?? false;
    } catch (error) {
      this.logger.warn(
        `No se pudo verificar si ${userId} es staff de la tienda ${storeId}: ${(error as Error).message}. Se deniega por defecto.`,
      );
      return false;
    }
  }

  async getStoreDisplay(storeId: string): Promise<StoreDisplay | null> {
    try {
      const { data } = await axios.get<{ name?: string; imageUrl?: string | null }>(
        `${this.baseUrl}/stores/${storeId}`,
        { timeout: 6000 },
      );
      if (!data?.name) return null;
      return { name: data.name, logoUrl: data.imageUrl ?? null };
    } catch (error) {
      this.logger.warn(
        `No se pudo obtener nombre/logo de la tienda ${storeId} en identity: ${(error as Error).message}.`,
      );
      return null;
    }
  }

  async getUserDisplay(userId: string): Promise<UserDisplay | null> {
    try {
      const { data } = await axios.get<{ fullName?: string; avatarUrl?: string | null }>(
        `${this.baseUrl}/internal/users/${userId}/profile`,
        { timeout: 6000 },
      );
      if (!data?.fullName) return null;
      return { fullName: data.fullName, avatarUrl: data.avatarUrl ?? null };
    } catch (error) {
      this.logger.warn(
        `No se pudo obtener nombre/avatar del usuario ${userId} en identity: ${(error as Error).message}.`,
      );
      return null;
    }
  }
}

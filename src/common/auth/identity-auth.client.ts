import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import type { AuthUser } from './auth-user';

interface CacheEntry {
  user: AuthUser;
  expiresAt: number;
}

/**
 * Cliente que valida tokens Firebase contra identity-service (GET /auth/validate).
 * Cachea el resultado por un breve TTL para no llamar a identity en cada request.
 */
@Injectable()
export class IdentityAuthClient {
  private readonly logger = new Logger(IdentityAuthClient.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs = 60_000;

  private get baseUrl(): string {
    return (process.env.IDENTITY_SERVICE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
  }

  async validate(token: string): Promise<AuthUser> {
    const cached = this.cache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.user;
    }

    try {
      const { data } = await axios.get(`${this.baseUrl}/auth/validate`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 8000,
      });
      const user: AuthUser = {
        userId: data.userId ?? data.id ?? data.firebaseUid,
        email: data.email,
        roles: data.roles ?? [],
        permissions: data.permissions ?? [],
      };
      if (!user.userId) {
        throw new UnauthorizedException('Token inválido: identity no devolvió userId');
      }
      this.cache.set(token, { user, expiresAt: Date.now() + this.ttlMs });
      return user;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      this.logger.warn(`Validación de token falló (status=${status ?? 'n/a'})`);
      throw new UnauthorizedException('Token de autenticación inválido o expirado');
    }
  }
}

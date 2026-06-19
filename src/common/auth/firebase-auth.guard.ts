import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { IdentityAuthClient } from './identity-auth.client';
import type { AuthUser } from './auth-user';

/**
 * Protege los endpoints REST validando el token Firebase contra identity-service.
 * En modo AUTH_DISABLED=true (solo dev/test) acepta un header `x-user-id` como
 * identidad simulada, sin contactar a identity.
 */
@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(private readonly identityAuth: IdentityAuthClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    if (process.env.AUTH_DISABLED === 'true') {
      const devUserId = (request.header('x-user-id') as string) ?? '00000000-0000-0000-0000-000000000000';
      request.user = { userId: devUserId, roles: ['BUYER'], permissions: [] } as AuthUser;
      return true;
    }

    const header = request.header('authorization');
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Falta el token Bearer de autenticación');
    }

    const token = header.slice('Bearer '.length).trim();
    request.user = await this.identityAuth.validate(token);
    return true;
  }
}

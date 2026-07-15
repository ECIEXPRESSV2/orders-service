import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Autoriza endpoints de administración (aprobar/rechazar devoluciones post-recogida). Debe
 * encadenarse DESPUÉS de `FirebaseAuthGuard` en el mismo `@UseGuards`: ese guard ya resuelve
 * `request.user.roles` al validar el token contra identity-service, así que este guard no
 * necesita una consulta adicional.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.user?.roles?.includes('ADMIN')) {
      throw new ForbiddenException('Se requiere rol de administrador de ECIExpress.');
    }
    return true;
  }
}

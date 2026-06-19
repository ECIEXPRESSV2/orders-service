/** Usuario autenticado, resuelto a partir del token Firebase vía identity-service. */
export interface AuthUser {
  userId: string;
  email?: string;
  roles: string[];
  permissions: string[];
}

declare module 'express' {
  interface Request {
    user?: AuthUser;
  }
}

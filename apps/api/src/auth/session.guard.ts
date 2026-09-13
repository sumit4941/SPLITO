import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiError } from '../common/api-error.js';
import { AuthService } from './auth.service.js';
import type { AuthContext } from './auth.types.js';

export const SESSION_COOKIE = 'SPLITO_SESSION';
export const CSRF_COOKIE = 'SPLITO_CSRF';

type AuthenticatedRequest = FastifyRequest & {
  auth?: AuthContext;
  cookies: Record<string, string | undefined>;
};

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const sessionToken = request.cookies[SESSION_COOKIE];
    if (!sessionToken) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to continue.');
    const auth = await this.authService.authenticateSession(sessionToken);
    if (!auth) throw new ApiError(401, 'SESSION_EXPIRED', 'The session is expired or revoked.');
    request.auth = auth;
    return true;
  }
}

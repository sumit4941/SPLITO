import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiError } from '../common/api-error.js';
import { hashesEqual } from './auth.crypto.js';
import { AuthService } from './auth.service.js';
import { CSRF_COOKIE } from './session.guard.js';
import type { AuthContext } from './auth.types.js';

type AuthenticatedRequest = FastifyRequest & {
  auth?: AuthContext;
  cookies: Record<string, string | undefined>;
};

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) throw new Error('CsrfGuard must run after SessionGuard');
    const cookieToken = request.cookies[CSRF_COOKIE];
    const header = request.headers['x-csrf-token'];
    const headerToken = Array.isArray(header) ? undefined : header;
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      throw new ApiError(403, 'CSRF_VALIDATION_FAILED', 'The CSRF token is missing or invalid.');
    }
    if (!hashesEqual(request.auth.csrfHash, this.authService.csrfHash(headerToken))) {
      throw new ApiError(403, 'CSRF_VALIDATION_FAILED', 'The CSRF token is missing or invalid.');
    }
    return true;
  }
}

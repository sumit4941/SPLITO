import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AuthContext } from './auth.types.js';

type AuthenticatedRequest = FastifyRequest & { auth?: AuthContext };

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) throw new Error('CurrentAuth used without SessionGuard');
    return request.auth;
  },
);

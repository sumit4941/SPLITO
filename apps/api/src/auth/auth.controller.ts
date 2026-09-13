import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Environment } from '@splito/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { APP_CONFIG } from '../config/app-config.js';
import { AuthService } from './auth.service.js';
import { CsrfGuard } from './csrf.guard.js';
import { CurrentAuth } from './current-auth.decorator.js';
import {
  loginSchema,
  registerSchema,
  requestMobileOtpSchema,
  verifyEmailSchema,
  verifyMobileOtpSchema,
  type LoginInput,
  type RegisterInput,
  type RequestMobileOtpInput,
  type VerifyEmailInput,
  type VerifyMobileOtpInput,
} from './auth.schemas.js';
import { CSRF_COOKIE, SESSION_COOKIE, SessionGuard } from './session.guard.js';
import type { AuthContext, NewSession } from './auth.types.js';

type CookieReply = FastifyReply & {
  setCookie(name: string, value: string, options: Record<string, unknown>): FastifyReply;
  clearCookie(name: string, options: Record<string, unknown>): FastifyReply;
};

function setSessionCookies(reply: CookieReply, config: Environment, session: NewSession): void {
  const sharedCookie = {
    path: '/',
    sameSite: 'lax' as const,
    secure: config.COOKIE_SECURE,
    expires: session.expiresAt,
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  };
  reply.setCookie(SESSION_COOKIE, session.sessionToken, { ...sharedCookie, httpOnly: true });
  reply.setCookie(CSRF_COOKIE, session.csrfToken, { ...sharedCookie, httpOnly: false });
}

@ApiTags('authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(APP_CONFIG) private readonly config: Environment,
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a pending account' })
  @ApiBody({
    schema: {
      example: { email: 'alex@example.test', password: 'a-long-passphrase', displayName: 'Alex' },
    },
  })
  register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Req() request: FastifyRequest,
  ): Promise<{ data: Awaited<ReturnType<AuthService['register']>> }> {
    return this.authService.register(body, request.id).then((data) => ({ data }));
  }

  @Post('verify-email')
  @HttpCode(204)
  @ApiOperation({ summary: 'Consume a single-use email verification token' })
  async verifyEmail(
    @Body(new ZodValidationPipe(verifyEmailSchema)) body: VerifyEmailInput,
  ): Promise<void> {
    await this.authService.verifyEmail(body.token);
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Create an opaque server-side session' })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: CookieReply,
  ): Promise<{ data: AuthContext['user'] }> {
    const session = await this.authService.login(body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? 'unknown',
    });
    setSessionCookies(reply, this.config, session);
    return { data: session.auth.user };
  }

  @Post('mobile/request-otp')
  @HttpCode(202)
  @ApiOperation({ summary: 'Request a single-use mobile sign-in code' })
  @ApiBody({ schema: { example: { mobileNumber: '9876543210' } } })
  requestMobileOtp(
    @Body(new ZodValidationPipe(requestMobileOtpSchema)) body: RequestMobileOtpInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: CookieReply,
  ): Promise<{ data: Awaited<ReturnType<AuthService['requestMobileOtp']>> }> {
    void reply.header('cache-control', 'no-store');
    return this.authService
      .requestMobileOtp(body, {
        id: request.id,
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? 'unknown',
      })
      .then((data) => ({ data }));
  }

  @Post('mobile/verify-otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify a mobile code and replace any prior active session' })
  async verifyMobileOtp(
    @Body(new ZodValidationPipe(verifyMobileOtpSchema)) body: VerifyMobileOtpInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: CookieReply,
  ): Promise<{ data: { user: AuthContext['user']; isNewAccount: boolean } }> {
    void reply.header('cache-control', 'no-store');
    const session = await this.authService.verifyMobileOtp(body, {
      id: request.id,
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? 'unknown',
    });
    setSessionCookies(reply, this.config, session);
    return { data: { user: session.auth.user, isNewAccount: session.isNewAccount } };
  }

  @Post('logout')
  @HttpCode(204)
  @ApiCookieAuth('session')
  @UseGuards(SessionGuard, CsrfGuard)
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) reply: CookieReply,
  ): Promise<void> {
    await this.authService.logout(auth.sessionId);
    const cookie = {
      path: '/',
      ...(this.config.COOKIE_DOMAIN ? { domain: this.config.COOKIE_DOMAIN } : {}),
    };
    reply.clearCookie(SESSION_COOKIE, cookie);
    reply.clearCookie(CSRF_COOKIE, cookie);
  }

  @Get('session')
  @ApiCookieAuth('session')
  @UseGuards(SessionGuard)
  session(@CurrentAuth() auth: AuthContext): { data: AuthContext['user'] } {
    return { data: auth.user };
  }
}

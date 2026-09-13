import { Body, Controller, Headers, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { CsrfGuard } from '../auth/csrf.guard.js';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthContext } from '../auth/auth.types.js';
import { requireIdempotencyKey } from '../common/request-headers.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  createSettlementSchema,
  settlementPreviewSchema,
  type CreateSettlementInput,
  type SettlementPreviewInput,
} from './settlements.schemas.js';
import {
  SettlementsService,
  type SettlementCreatedResponse,
  type SettlementPreviewResponse,
} from './settlements.service.js';

@ApiTags('settlements')
@ApiCookieAuth('session')
@UseGuards(SessionGuard)
@Controller('settlements')
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Post('preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Preview a manual settlement against current bilateral debt' })
  async preview(
    @Body(new ZodValidationPipe(settlementPreviewSchema)) body: SettlementPreviewInput,
    @CurrentAuth() auth: AuthContext,
  ): Promise<{ data: SettlementPreviewResponse }> {
    return { data: await this.settlements.preview(body, auth) };
  }

  @Post()
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Record a version-checked manual payment assertion atomically' })
  async create(
    @Body(new ZodValidationPipe(createSettlementSchema)) body: CreateSettlementInput,
    @Headers('idempotency-key') idempotencyHeader: string | string[] | undefined,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ data: SettlementCreatedResponse }> {
    const result = await this.settlements.create(body, auth, {
      idempotencyKey: requireIdempotencyKey(idempotencyHeader),
      requestId: request.id,
    });
    reply.header('location', `/api/v1/settlements/${result.data.id}`);
    if (result.replayed) reply.header('idempotency-replayed', 'true');
    return { data: result.data };
  }
}

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { CsrfGuard } from '../auth/csrf.guard.js';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthContext } from '../auth/auth.types.js';
import { requireIdempotencyKey, requireResourceVersion } from '../common/request-headers.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  expenseListQuerySchema,
  expenseMutationSchema,
  type ExpenseListQuery,
  type ExpenseMutationInput,
} from './expenses.schemas.js';
import { ExpensesService } from './expenses.service.js';
import type { ExpenseSummaryResponse, SplitPreviewResponse } from './expenses.types.js';

@ApiTags('expenses')
@ApiCookieAuth('session')
@UseGuards(SessionGuard)
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Post('split-preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Preview an authoritative deterministic split without posting it' })
  async preview(
    @Body(new ZodValidationPipe(expenseMutationSchema)) body: ExpenseMutationInput,
    @CurrentAuth() auth: AuthContext,
  ): Promise<{ data: SplitPreviewResponse }> {
    return { data: await this.expenses.preview(body, auth) };
  }

  @Post()
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Post an expense, journal, projections, outbox, and idempotency outcome atomically',
  })
  async create(
    @Body(new ZodValidationPipe(expenseMutationSchema)) body: ExpenseMutationInput,
    @Headers('idempotency-key') idempotencyHeader: string | string[] | undefined,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ data: ExpenseSummaryResponse }> {
    const result = await this.expenses.create(body, auth, {
      idempotencyKey: requireIdempotencyKey(idempotencyHeader),
      requestId: request.id,
    });
    reply.header('location', `/api/v1/expenses/${result.data.id}`);
    if (result.replayed) reply.header('idempotency-replayed', 'true');
    return { data: result.data };
  }

  @Put(':expenseId')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Replace an expense by appending a revision and reversing its prior journal',
  })
  async update(
    @Param('expenseId') expenseId: string,
    @Body(new ZodValidationPipe(expenseMutationSchema)) body: ExpenseMutationInput,
    @Headers('idempotency-key') idempotencyHeader: string | string[] | undefined,
    @Headers('if-match') ifMatchHeader: string | string[] | undefined,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ data: ExpenseSummaryResponse }> {
    const result = await this.expenses.update(expenseId, body, auth, {
      idempotencyKey: requireIdempotencyKey(idempotencyHeader),
      expectedVersion: requireResourceVersion(ifMatchHeader),
      requestId: request.id,
    });
    reply.header('etag', `"${result.data.version}"`);
    if (result.replayed) reply.header('idempotency-replayed', 'true');
    return { data: result.data };
  }

  @Get(':expenseId')
  @ApiOperation({
    summary: 'Get an authorized expense with its current revision, payers, and shares',
  })
  async detail(
    @Param('expenseId') expenseId: string,
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ data: ExpenseSummaryResponse }> {
    const data = await this.expenses.detail(expenseId, auth);
    reply.header('etag', `"${data.version}"`);
    return { data };
  }
}

@ApiTags('groups', 'expenses')
@ApiCookieAuth('session')
@UseGuards(SessionGuard)
@Controller('groups/:groupId/expenses')
export class GroupExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @ApiOperation({ summary: 'List posted group expenses with stable cursor pagination' })
  async list(
    @Param('groupId') groupId: string,
    @Query(new ZodValidationPipe(expenseListQuerySchema)) query: ExpenseListQuery,
    @CurrentAuth() auth: AuthContext,
  ): Promise<{ data: Awaited<ReturnType<ExpensesService['listForGroup']>> }> {
    return { data: await this.expenses.listForGroup(groupId, query, auth) };
  }
}

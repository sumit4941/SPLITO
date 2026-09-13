import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthContext } from '../auth/auth.types.js';
import { BalancesService } from './balances.service.js';
import type { BalanceLine } from './balances.repository.js';

@ApiTags('balances')
@ApiCookieAuth('session')
@UseGuards(SessionGuard)
@Controller('balances')
export class BalancesController {
  constructor(private readonly balances: BalancesService) {}

  @Get()
  @ApiOperation({
    summary: "List the current participant's nonzero balances by context and currency",
  })
  async list(@CurrentAuth() auth: AuthContext): Promise<{ data: BalanceLine[] }> {
    return { data: await this.balances.personal(auth) };
  }
}

@ApiTags('groups', 'balances')
@ApiCookieAuth('session')
@UseGuards(SessionGuard)
@Controller('groups/:groupId/balances')
export class GroupBalancesController {
  constructor(private readonly balances: BalancesService) {}

  @Get()
  @ApiOperation({ summary: "Get the current participant's balances in one group" })
  async list(
    @Param('groupId') groupId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<{ data: BalanceLine[] }> {
    return { data: await this.balances.forGroup(groupId, auth) };
  }
}

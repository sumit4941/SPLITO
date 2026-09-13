import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from './current-auth.decorator.js';
import { SessionGuard } from './session.guard.js';
import type { AuthContext } from './auth.types.js';

@ApiTags('users')
@ApiCookieAuth('session')
@UseGuards(SessionGuard)
@Controller()
export class MeController {
  @Get('me')
  @ApiOperation({ summary: 'Get the authenticated user' })
  me(@CurrentAuth() auth: AuthContext): { data: AuthContext['user'] } {
    return { data: auth.user };
  }
}

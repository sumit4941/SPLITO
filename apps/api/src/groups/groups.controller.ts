import { Body, Controller, Get, HttpCode, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { CsrfGuard } from '../auth/csrf.guard.js';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthContext } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { GroupsService } from './groups.service.js';
import {
  addGroupMemberSchema,
  createGroupSchema,
  groupInvitationTokenSchema,
  type AddGroupMemberInput,
  type CreateGroupInput,
  type GroupInvitationTokenInput,
} from './groups.schemas.js';

const invitationSmsRateLimit = { max: 10, timeWindow: '1 minute' } as const;

@ApiTags('groups')
@ApiCookieAuth('session')
@UseGuards(SessionGuard)
@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  @ApiOperation({ summary: 'List groups visible to the current member' })
  async list(
    @CurrentAuth() auth: AuthContext,
  ): Promise<{ data: Awaited<ReturnType<GroupsService['list']>> }> {
    return { data: await this.groups.list(auth) };
  }

  @Post()
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Create a group and its owner membership atomically' })
  async create(
    @Body(new ZodValidationPipe(createGroupSchema)) body: CreateGroupInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<{ data: Awaited<ReturnType<GroupsService['create']>> }> {
    return { data: await this.groups.create(body, auth, request.id) };
  }

  @Post(':groupId/members')
  @UseGuards(CsrfGuard)
  @RouteConfig({ rateLimit: invitationSmsRateLimit })
  @ApiOperation({ summary: 'Add a registered mobile account or send a secure group invitation' })
  async addMember(
    @Param('groupId') groupId: string,
    @Body(new ZodValidationPipe(addGroupMemberSchema)) body: AddGroupMemberInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ data: Awaited<ReturnType<GroupsService['addMember']>> }> {
    const data = await this.groups.addMember(groupId, body, auth, request.id);
    reply.header('cache-control', 'no-store');
    void reply.status(data.outcome === 'member_added' ? 201 : 202);
    return { data };
  }

  @Get(':groupId')
  @ApiOperation({ summary: 'Get a group and its membership roster' })
  async detail(
    @Param('groupId') groupId: string,
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{
    data: Awaited<ReturnType<GroupsService['detail']>>['group'] & {
      members: Awaited<ReturnType<GroupsService['detail']>>['members'];
      pendingInvitations: Awaited<ReturnType<GroupsService['detail']>>['pendingInvitations'];
    };
  }> {
    const data = await this.groups.detail(groupId, auth);
    reply.header('etag', `"${data.group.version}"`);
    return {
      data: {
        ...data.group,
        members: data.members,
        pendingInvitations: data.pendingInvitations,
      },
    };
  }
}

@ApiTags('group invitations')
@ApiCookieAuth('session')
@UseGuards(SessionGuard)
@Controller('group-invitations')
export class GroupInvitationsController {
  constructor(private readonly groups: GroupsService) {}

  @Post('preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Preview a phone-bound group invitation after sign-in' })
  async preview(
    @Body(new ZodValidationPipe(groupInvitationTokenSchema)) body: GroupInvitationTokenInput,
    @CurrentAuth() auth: AuthContext,
  ): Promise<{ data: Awaited<ReturnType<GroupsService['previewInvitation']>> }> {
    return { data: await this.groups.previewInvitation(body, auth) };
  }

  @Post('accept')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Accept a phone-bound invitation and join its active group' })
  async accept(
    @Body(new ZodValidationPipe(groupInvitationTokenSchema)) body: GroupInvitationTokenInput,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<{ data: Awaited<ReturnType<GroupsService['acceptInvitation']>> }> {
    return { data: await this.groups.acceptInvitation(body, auth, request.id) };
  }
}

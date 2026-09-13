import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiConsumes, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { CsrfGuard } from '../auth/csrf.guard.js';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthContext } from '../auth/auth.types.js';
import { ApiError } from '../common/api-error.js';
import { MediaService } from './media.service.js';
import type { MediaDownload, MediaMutationResult, RawImageUpload } from './media.types.js';

const uploadRateLimit = { max: 12, timeWindow: '1 minute' } as const;

interface MultipartImageFile {
  readonly fieldname: string;
  readonly mimetype: string;
  readonly file: { resume(): void };
  toBuffer(): Promise<Buffer>;
}

type MediaRequest = FastifyRequest & {
  isMultipart(): boolean;
  file(): Promise<MultipartImageFile | undefined>;
};

function fastifyErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

async function readSingleImage(request: MediaRequest): Promise<RawImageUpload> {
  if (!request.isMultipart()) {
    throw new ApiError(415, 'MULTIPART_IMAGE_REQUIRED', 'Upload the image as multipart/form-data.');
  }
  try {
    const file = await request.file();
    if (!file) throw new ApiError(400, 'IMAGE_FILE_REQUIRED', 'Choose an image to upload.');
    if (file.fieldname !== 'file') {
      file.file.resume();
      throw new ApiError(400, 'IMAGE_FILE_REQUIRED', 'The image field must be named file.');
    }
    return {
      bytes: await file.toBuffer(),
      declaredMediaType: file.mimetype.toLowerCase(),
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const code = fastifyErrorCode(error);
    if (
      code === 'FST_REQ_FILE_TOO_LARGE' ||
      code === 'FST_FILES_LIMIT' ||
      code === 'FST_FIELDS_LIMIT' ||
      code === 'FST_PARTS_LIMIT'
    ) {
      throw new ApiError(
        413,
        'IMAGE_UPLOAD_LIMIT_EXCEEDED',
        'Upload exactly one image within the configured size limit.',
      );
    }
    if (code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
      throw new ApiError(
        415,
        'MULTIPART_IMAGE_REQUIRED',
        'Upload the image as multipart/form-data.',
      );
    }
    throw error;
  }
}

function requireVersion(value: string | undefined): string {
  if (!value || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new ApiError(404, 'IMAGE_NOT_FOUND', 'The image does not exist or is not accessible.');
  }
  return value;
}

function sendImage(reply: FastifyReply, media: MediaDownload, filename: string): void {
  void reply
    .header('cache-control', 'private, no-store')
    .header('content-disposition', `inline; filename="${filename}"`)
    .header('content-length', String(media.byteSize))
    .header('etag', media.etag)
    .header('vary', 'Cookie')
    .header('x-content-type-options', 'nosniff')
    .type(media.mediaType)
    .send(media.bytes);
}

@ApiTags('media')
@ApiCookieAuth('session')
@UseGuards(SessionGuard)
@Controller()
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Put('me/avatar')
  @UseGuards(CsrfGuard)
  @RouteConfig({ rateLimit: uploadRateLimit })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload and replace the authenticated user avatar' })
  async uploadAvatar(
    @CurrentAuth() auth: AuthContext,
    @Req() request: MediaRequest,
  ): Promise<{ data: MediaMutationResult }> {
    this.media.assertUploadAvailable();
    const upload = await readSingleImage(request);
    return { data: await this.media.uploadAvatar(upload, auth, request.id) };
  }

  @Delete('me/avatar')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Delete the authenticated user avatar' })
  async deleteAvatar(
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.media.deleteAvatar(auth, request.id);
  }

  @Get('participants/:participantId/avatar')
  @ApiOperation({ summary: 'Read an authorized versioned participant avatar' })
  async participantAvatar(
    @Param('participantId') participantId: string,
    @Query('v') version: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const media = await this.media.participantAvatar(participantId, requireVersion(version), auth);
    sendImage(reply, media, 'avatar.webp');
  }

  @Put('groups/:groupId/image')
  @UseGuards(CsrfGuard)
  @RouteConfig({ rateLimit: uploadRateLimit })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload and replace a group image as owner or administrator' })
  async uploadGroupImage(
    @Param('groupId') groupId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: MediaRequest,
  ): Promise<{ data: MediaMutationResult }> {
    this.media.assertUploadAvailable();
    const upload = await readSingleImage(request);
    return { data: await this.media.uploadGroupImage(groupId, upload, auth, request.id) };
  }

  @Delete('groups/:groupId/image')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Delete a group image as owner or administrator' })
  async deleteGroupImage(
    @Param('groupId') groupId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.media.deleteGroupImage(groupId, auth, request.id);
  }

  @Get('groups/:groupId/image')
  @ApiOperation({ summary: 'Read an authorized versioned group image' })
  async groupImage(
    @Param('groupId') groupId: string,
    @Query('v') version: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const media = await this.media.groupImage(groupId, requireVersion(version), auth);
    sendImage(reply, media, 'group-image.webp');
  }
}

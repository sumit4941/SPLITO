import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MongoService } from '../database/mongo.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly mongo: MongoService) {}

  @Get('live')
  @ApiOperation({ summary: 'Process liveness' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'MongoDB-backed readiness' })
  async ready(): Promise<{ status: 'ok' }> {
    await this.mongo.ping();
    return { status: 'ok' };
  }
}

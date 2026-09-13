import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OracleService } from '../database/oracle.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly oracle: OracleService) {}

  @Get('live')
  @ApiOperation({ summary: 'Process liveness' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Oracle-backed readiness' })
  async ready(): Promise<{
    status: 'ok';
    database: { databaseVersion: string; currentSchema: string };
  }> {
    return { status: 'ok', database: await this.oracle.ping() };
  }
}

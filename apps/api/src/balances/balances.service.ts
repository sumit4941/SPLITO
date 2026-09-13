import { Injectable } from '@nestjs/common';
import { ContextAccessRepository } from '../access/context-access.repository.js';
import type { AuthContext } from '../auth/auth.types.js';
import { OracleService } from '../database/oracle.service.js';
import { BalancesRepository, type BalanceLine } from './balances.repository.js';

@Injectable()
export class BalancesService {
  constructor(
    private readonly balances: BalancesRepository,
    private readonly access: ContextAccessRepository,
    private readonly oracle: OracleService,
  ) {}

  personal(auth: AuthContext): Promise<BalanceLine[]> {
    return this.balances.personal(auth.user.participantId);
  }

  forGroup(groupId: string, auth: AuthContext): Promise<BalanceLine[]> {
    return this.oracle.withConnection(async (connection) => {
      const access = await this.access.contextIdForGroup(
        connection,
        groupId,
        auth.user.participantId,
      );
      return this.balances.personalForContext(
        connection,
        access.contextId,
        auth.user.participantId,
      );
    });
  }
}

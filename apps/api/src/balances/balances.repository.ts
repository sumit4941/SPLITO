import { Injectable } from '@nestjs/common';
import type { Connection } from 'oracledb';
import { OracleService } from '../database/oracle.service.js';
import { rawToUuid, uuidToRaw } from '../database/uuid.js';

interface BalanceRow {
  GROUP_ID: Buffer;
  GROUP_NAME: string;
  CURRENCY_CODE: string;
  NET_MINOR: string;
  PROJECTION_VERSION: string;
}

export interface BalanceLine {
  readonly currency: string;
  readonly netAmountMinor: string;
  readonly owedAmountMinor: string;
  readonly receivableAmountMinor: string;
  readonly contextId: string;
  readonly contextName: string;
  readonly version: string;
}

function mapBalance(row: BalanceRow): BalanceLine {
  const net = BigInt(row.NET_MINOR);
  return {
    currency: row.CURRENCY_CODE.trim(),
    netAmountMinor: row.NET_MINOR,
    owedAmountMinor: net < 0n ? (-net).toString() : '0',
    receivableAmountMinor: net > 0n ? net.toString() : '0',
    contextId: rawToUuid(row.GROUP_ID),
    contextName: row.GROUP_NAME,
    version: row.PROJECTION_VERSION,
  };
}

@Injectable()
export class BalancesRepository {
  constructor(private readonly oracle: OracleService) {}

  async personal(participantId: string): Promise<BalanceLine[]> {
    return this.oracle.withConnection(async (connection) => {
      const result = await this.oracle.execute<BalanceRow>(
        connection,
        `SELECT G.GROUP_ID, G.GROUP_NAME, B.CURRENCY_CODE,
                TO_CHAR(B.NET_MINOR_SIGNED) AS NET_MINOR,
                TO_CHAR(B.PROJECTION_VERSION) AS PROJECTION_VERSION
           FROM SPLITO_BALANCE_PROJECTIONS B
           JOIN SPLITO_GROUPS G ON G.CONTEXT_ID = B.CONTEXT_ID
           JOIN SPLITO_CONTEXT_MEMBERS M
             ON M.CONTEXT_ID = B.CONTEXT_ID
            AND M.PARTICIPANT_ID = :participantId
            AND M.STATUS = 'ACTIVE'
          WHERE B.PARTICIPANT_ID = :participantId
            AND B.NET_MINOR_SIGNED <> 0
          ORDER BY G.GROUP_NAME, B.CURRENCY_CODE, G.GROUP_ID`,
        { participantId: uuidToRaw(participantId) },
      );
      return (result.rows ?? []).map(mapBalance);
    });
  }

  async personalForContext(
    connection: Connection,
    contextId: string,
    participantId: string,
  ): Promise<BalanceLine[]> {
    const result = await this.oracle.execute<BalanceRow>(
      connection,
      `SELECT G.GROUP_ID, G.GROUP_NAME, B.CURRENCY_CODE,
              TO_CHAR(B.NET_MINOR_SIGNED) AS NET_MINOR,
              TO_CHAR(B.PROJECTION_VERSION) AS PROJECTION_VERSION
         FROM SPLITO_BALANCE_PROJECTIONS B
         JOIN SPLITO_GROUPS G ON G.CONTEXT_ID = B.CONTEXT_ID
        WHERE B.CONTEXT_ID = :contextId
          AND B.PARTICIPANT_ID = :participantId
          AND B.NET_MINOR_SIGNED <> 0
        ORDER BY B.CURRENCY_CODE`,
      {
        contextId: uuidToRaw(contextId),
        participantId: uuidToRaw(participantId),
      },
    );
    return (result.rows ?? []).map(mapBalance);
  }
}

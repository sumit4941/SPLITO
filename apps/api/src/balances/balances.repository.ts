import { Injectable } from '@nestjs/common';
import { Decimal128, type Long } from 'mongodb';
import { decimalToMinor, MongoService, type MongoUnitOfWork } from '../database/mongo.service.js';

interface BalanceDocument {
  _id: string;
  contextId: string;
  participantId: string;
  currencyCode: string;
  netMinor: Decimal128;
  version: number | Long;
}

interface GroupDocument {
  _id: string;
  contextId: string;
  name: string;
}

interface MemberDocument {
  contextId: string;
  participantId: string;
  status: string;
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

function versionText(value: number | Long): string {
  return value.toString();
}

function mapBalance(row: BalanceDocument, group: GroupDocument): BalanceLine {
  const net = decimalToMinor(row.netMinor);
  return {
    currency: row.currencyCode,
    netAmountMinor: net.toString(),
    owedAmountMinor: net < 0n ? (-net).toString() : '0',
    receivableAmountMinor: net > 0n ? net.toString() : '0',
    contextId: group._id,
    contextName: group.name,
    version: versionText(row.version),
  };
}

@Injectable()
export class BalancesRepository {
  constructor(private readonly mongo: MongoService) {}

  async personal(participantId: string): Promise<BalanceLine[]> {
    return this.mongo.withTransaction(async (work) => {
      const options = work.session ? { session: work.session } : undefined;
      const members = await work.db
        .collection<MemberDocument>('contextMembers')
        .find({ participantId, status: 'ACTIVE' }, options)
        .project<{ contextId: string }>({ contextId: 1 })
        .toArray();
      const contextIds = members.map((member) => member.contextId);
      if (contextIds.length === 0) return [];
      const balances = await work.db
        .collection<BalanceDocument>('balanceProjections')
        .find(
          {
            participantId,
            contextId: { $in: contextIds },
            netMinor: { $ne: Decimal128.fromString('0') },
          },
          options,
        )
        .toArray();
      const groups = await work.db
        .collection<GroupDocument>('groups')
        .find({ contextId: { $in: contextIds } }, options)
        .toArray();
      const groupByContext = new Map(groups.map((group) => [group.contextId, group]));
      return balances
        .flatMap((balance) => {
          const group = groupByContext.get(balance.contextId);
          return group ? [mapBalance(balance, group)] : [];
        })
        .sort(
          (left, right) =>
            left.contextName.localeCompare(right.contextName) ||
            left.currency.localeCompare(right.currency) ||
            left.contextId.localeCompare(right.contextId),
        );
    });
  }

  async personalForContext(
    work: MongoUnitOfWork,
    contextId: string,
    participantId: string,
  ): Promise<BalanceLine[]> {
    const options = work.session ? { session: work.session } : undefined;
    const balances = await work.db
      .collection<BalanceDocument>('balanceProjections')
      .find({ contextId, participantId, netMinor: { $ne: Decimal128.fromString('0') } }, options)
      .sort({ currencyCode: 1 })
      .toArray();
    const group = await work.db.collection<GroupDocument>('groups').findOne({ contextId }, options);
    if (!group) return [];
    return balances.map((balance) => mapBalance(balance, group));
  }
}

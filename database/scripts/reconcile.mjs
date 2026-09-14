import { Decimal128 } from 'mongodb';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { connectMongo } from '../lib/mongodb-env.mjs';
import { COLLECTIONS } from '../schema.mjs';

const rebuildRaw = (process.env.SPLITO_RECONCILE_REBUILD ?? 'false').trim().toLowerCase();
if (!['true', 'false'].includes(rebuildRaw)) {
  throw new Error('SPLITO_RECONCILE_REBUILD must be true or false');
}
const rebuild = rebuildRaw === 'true';
const MAX_MINOR_AMOUNT = 9_999_999_999_999_999_999n;

function decimalToBigInt(value) {
  if (!(value instanceof Decimal128)) throw new Error('Expected a MongoDB Decimal128 amount');
  const match = /^(-?)(\d+)(?:\.(\d*))?(?:E([+-]?\d+))?$/iu.exec(value.toString());
  if (!match) throw new Error('MongoDB returned a non-integer monetary value');
  const [, sign, whole = '', fraction = '', exponentText = '0'] = match;
  const exponent = Number(exponentText);
  const digits = `${whole}${fraction}`;
  const scale = exponent - fraction.length;
  if (scale >= 0) return BigInt(`${sign}${digits}${'0'.repeat(scale)}`);
  const split = digits.length + scale;
  if (split < 0 || !/^0*$/u.test(digits.slice(Math.max(split, 0)))) {
    throw new Error('MongoDB returned a fractional monetary value');
  }
  return BigInt(`${sign}${split <= 0 ? '0' : digits.slice(0, split)}`);
}

function projectionKey(value) {
  return `${value.contextId}:${value.participantId}:${value.currencyCode}`;
}

function bilateralProjectionKey(value) {
  return `${value.contextId}:${value.participantLowId}:${value.participantHighId}:${value.currencyCode}`;
}

function withinMinorBounds(value) {
  return value >= -MAX_MINOR_AMOUNT && value <= MAX_MINOR_AMOUNT;
}

function integerVersion(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (value && typeof value.toString === 'function' && /^\d+$/u.test(value.toString())) {
    const parsed = Number(value.toString());
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new Error('Projection version is not a non-negative safe integer');
}

export async function loadExpectedBalances(database, session) {
  const rows = await database
    .collection(COLLECTIONS.ledgerBatches)
    .aggregate(
      [
        { $unwind: '$postings' },
        {
          $group: {
            _id: {
              contextId: '$contextId',
              participantId: '$postings.participantId',
              currencyCode: '$currencyCode',
            },
            netMinor: { $sum: '$postings.amountMinor' },
            batches: { $addToSet: '$_id' },
          },
        },
      ],
      { session },
    )
    .toArray();

  const expected = new Map(
    rows
      .map((row) => ({
        contextId: row._id.contextId,
        participantId: row._id.participantId,
        currencyCode: row._id.currencyCode,
        netMinor: decimalToBigInt(row.netMinor),
        version: row.batches.length,
      }))
      .map((row) => [projectionKey(row), row]),
  );
  const outOfBounds = [...expected.values()].filter((row) => !withinMinorBounds(row.netMinor));
  if (outOfBounds.length > 0) {
    throw new Error('The journal produces balance projections outside the signed 19-digit bound', {
      cause: outOfBounds,
    });
  }
  return expected;
}

export async function loadActualBalances(database, session) {
  const rows = await database
    .collection(COLLECTIONS.balanceProjections)
    .find({}, { session })
    .toArray();
  return new Map(
    rows
      .map((row) => ({
        contextId: row.contextId,
        participantId: row.participantId,
        currencyCode: row.currencyCode,
        netMinor: decimalToBigInt(row.netMinor),
        version: integerVersion(row.version),
      }))
      .map((row) => {
        if (!withinMinorBounds(row.netMinor)) {
          throw new Error('A stored balance projection is outside the signed 19-digit bound');
        }
        return [projectionKey(row), row];
      }),
  );
}

export function balanceDifferences(expected, actual) {
  const keys = new Set([...expected.keys(), ...actual.keys()]);
  return [...keys].sort().flatMap((key) => {
    const wanted = expected.get(key);
    const found = actual.get(key);
    if (wanted?.netMinor === found?.netMinor && wanted?.version === found?.version) return [];
    const identity = wanted ?? found;
    return [
      {
        contextId: identity.contextId,
        participantId: identity.participantId,
        currency: identity.currencyCode,
        expectedMinor: wanted?.netMinor.toString() ?? '0',
        actualMinor: found?.netMinor.toString() ?? '0',
        expectedVersion: wanted?.version ?? 0,
        actualVersion: found?.version ?? 0,
      },
    ];
  });
}

async function loadFinancialHistory(database, session) {
  const batches = await database
    .collection(COLLECTIONS.ledgerBatches)
    .find({}, { session })
    .sort({ postedAt: 1, _id: 1 })
    .toArray();
  const expenseRevisions = await database
    .collection(COLLECTIONS.expenseRevisions)
    .find({}, { session })
    .toArray();
  const settlements = await database
    .collection(COLLECTIONS.settlements)
    .find({}, { session })
    .toArray();
  const settlementRevisions = await database
    .collection(COLLECTIONS.settlementRevisions)
    .find({}, { session })
    .toArray();
  const idempotencyReceipts = await database
    .collection(COLLECTIONS.idempotencyReceipts)
    .find({}, { session })
    .toArray();
  return {
    batches,
    batchById: new Map(batches.map((batch) => [batch._id, batch])),
    expenseRevisions,
    expenseRevisionById: new Map(expenseRevisions.map((revision) => [revision._id, revision])),
    settlements,
    settlementById: new Map(settlements.map((settlement) => [settlement._id, settlement])),
    settlementRevisionById: new Map(
      settlementRevisions.map((revision) => [revision._id, revision]),
    ),
    idempotencyReceipts,
    idempotencyReceiptById: new Map(idempotencyReceipts.map((receipt) => [receipt._id, receipt])),
  };
}

function amountMap(rows, participantField, amountField) {
  const result = new Map();
  for (const row of rows) {
    const participantId = row[participantField];
    const amount = decimalToBigInt(row[amountField]);
    result.set(participantId, (result.get(participantId) ?? 0n) + amount);
  }
  return result;
}

function postingMap(batch) {
  return amountMap(batch.postings, 'participantId', 'amountMinor');
}

function expenseEffect(revision) {
  const result = amountMap(revision.payers, 'participantId', 'paidMinor');
  for (const share of revision.shares) {
    const amount = decimalToBigInt(share.owedMinor);
    result.set(share.participantId, (result.get(share.participantId) ?? 0n) - amount);
  }
  return new Map([...result].filter(([, amount]) => amount !== 0n));
}

function obligationEffect(revision) {
  const result = new Map();
  for (const obligation of revision.obligations) {
    const amount = decimalToBigInt(obligation.amountMinor);
    result.set(
      obligation.debtorParticipantId,
      (result.get(obligation.debtorParticipantId) ?? 0n) - amount,
    );
    result.set(
      obligation.creditorParticipantId,
      (result.get(obligation.creditorParticipantId) ?? 0n) + amount,
    );
  }
  return new Map([...result].filter(([, amount]) => amount !== 0n));
}

function mapsEqual(actual, expected, multiplier = 1n) {
  if (actual.size !== expected.size) return false;
  return [...expected].every(
    ([participantId, amount]) => actual.get(participantId) === amount * multiplier,
  );
}

export function findInvalidExpenseRevisions(history) {
  return history.expenseRevisions.flatMap((revision) => {
    try {
      const payers = Array.isArray(revision.payers) ? revision.payers : [];
      const shares = Array.isArray(revision.shares) ? revision.shares : [];
      const obligations = Array.isArray(revision.obligations) ? revision.obligations : [];
      const total = decimalToBigInt(revision.totalMinor);
      const payerAmounts = payers.map((payer) => decimalToBigInt(payer.paidMinor));
      const shareAmounts = shares.map((share) => decimalToBigInt(share.owedMinor));
      const obligationAmounts = obligations.map((item) => decimalToBigInt(item.amountMinor));
      const payerSum = payerAmounts.reduce((sum, amount) => sum + amount, 0n);
      const shareSum = shareAmounts.reduce((sum, amount) => sum + amount, 0n);
      const validAmounts =
        total > 0n &&
        withinMinorBounds(total) &&
        payerAmounts.every((amount) => amount > 0n && withinMinorBounds(amount)) &&
        shareAmounts.every((amount) => amount >= 0n && withinMinorBounds(amount)) &&
        obligationAmounts.every((amount) => amount > 0n && withinMinorBounds(amount));
      const uniquePayers =
        new Set(payers.map((payer) => payer.participantId)).size === payers.length;
      const uniqueShares =
        new Set(shares.map((share) => share.participantId)).size === shares.length;
      const uniquePayerOrders =
        new Set(payers.map((payer) => payer.allocationOrder)).size === payers.length;
      const uniqueShareOrders =
        new Set(shares.map((share) => share.allocationOrder)).size === shares.length;
      const uniqueObligationIds =
        new Set(obligations.map((item) => item.id)).size === obligations.length;
      const uniqueObligationOrders =
        new Set(obligations.map((item) => item.matchOrder)).size === obligations.length;
      const validObligations = obligations.every(
        (item) => item.debtorParticipantId !== item.creditorParticipantId,
      );
      const validObligationFlow = mapsEqual(obligationEffect(revision), expenseEffect(revision));
      if (
        payers.length > 0 &&
        shares.length > 0 &&
        payerSum === total &&
        shareSum === total &&
        validAmounts &&
        uniquePayers &&
        uniqueShares &&
        uniquePayerOrders &&
        uniqueShareOrders &&
        uniqueObligationIds &&
        uniqueObligationOrders &&
        validObligations &&
        validObligationFlow
      ) {
        return [];
      }
      return [
        {
          revisionId: String(revision._id),
          totalMinor: total.toString(),
          payerSum: payerSum.toString(),
          shareSum: shareSum.toString(),
          validAmounts,
          uniquePayers,
          uniqueShares,
          uniquePayerOrders,
          uniqueShareOrders,
          uniqueObligationIds,
          uniqueObligationOrders,
          validObligations,
          validObligationFlow,
        },
      ];
    } catch (error) {
      return [{ revisionId: String(revision._id), invalidAmount: String(error) }];
    }
  });
}

export function findInvalidSettlements(history) {
  return history.settlements.flatMap((settlement) => {
    try {
      const amount = decimalToBigInt(settlement.amountMinor);
      const revision = history.settlementRevisionById.get(settlement.currentRevisionId);
      const valid =
        amount > 0n &&
        withinMinorBounds(amount) &&
        settlement.senderParticipantId !== settlement.recipientParticipantId &&
        revision?.settlementId === settlement._id &&
        decimalToBigInt(revision.amountMinor) === amount &&
        revision.method === settlement.method;
      return valid
        ? []
        : [
            {
              settlementId: String(settlement._id),
              amountMinor: amount.toString(),
              distinctParticipants:
                settlement.senderParticipantId !== settlement.recipientParticipantId,
              matchingCurrentRevision: Boolean(revision?.settlementId === settlement._id),
            },
          ];
    } catch (error) {
      return [{ settlementId: String(settlement._id), invalidAmount: String(error) }];
    }
  });
}

function expectedBatchEffect(batch, history) {
  if (batch.batchType === 'REVERSAL') {
    const reversed = history.batchById.get(batch.reversesBatchId);
    return reversed
      ? new Map([...postingMap(reversed)].map(([id, amount]) => [id, -amount]))
      : null;
  }
  if (batch.batchType === 'EXPENSE' && batch.sourceType === 'EXPENSE') {
    const revision = history.expenseRevisionById.get(batch.sourceRevisionId);
    return revision?.expenseId === batch.sourceId ? expenseEffect(revision) : null;
  }
  if (batch.batchType === 'SETTLEMENT' && batch.sourceType === 'SETTLEMENT') {
    const settlement = history.settlementById.get(batch.sourceId);
    if (!settlement || settlement.currentRevisionId !== batch.sourceRevisionId) return null;
    const amount = decimalToBigInt(settlement.amountMinor);
    return new Map([
      [settlement.senderParticipantId, amount],
      [settlement.recipientParticipantId, -amount],
    ]);
  }
  return null;
}

function expectedReceiptOperation(batch, history) {
  if (batch.batchType === 'REVERSAL' && batch.sourceType === 'EXPENSE') {
    return { operationKey: 'expense.update', httpStatus: 200 };
  }
  if (batch.batchType === 'EXPENSE' && batch.sourceType === 'EXPENSE') {
    const revision = history.expenseRevisionById.get(batch.sourceRevisionId);
    if (!revision || !Number.isSafeInteger(revision.revisionNumber)) return null;
    return revision.revisionNumber === 1
      ? { operationKey: 'expense.create', httpStatus: 201 }
      : { operationKey: 'expense.update', httpStatus: 200 };
  }
  if (batch.batchType === 'SETTLEMENT' && batch.sourceType === 'SETTLEMENT') {
    return { operationKey: 'settlement.create', httpStatus: 201 };
  }
  return null;
}

function validIdempotencyReceipt(batch, history) {
  if (
    typeof batch.idempotencyId !== 'string' ||
    batch.idempotencyId.length === 0 ||
    typeof batch.actorParticipantId !== 'string' ||
    batch.actorParticipantId.length === 0
  ) {
    return false;
  }
  const receipt = history.idempotencyReceiptById?.get(batch.idempotencyId);
  const expected = expectedReceiptOperation(batch, history);
  if (!receipt || !expected || !/^[0-9a-f]{64}$/u.test(receipt.keyHash)) return false;
  const expectedScopeId = createHash('sha256')
    .update(
      `${receipt.actorParticipantId}\u0000${receipt.operationKey}\u0000${receipt.keyHash}`,
      'utf8',
    )
    .digest('hex');
  return (
    receipt._id === batch.idempotencyId &&
    receipt.scopeId === expectedScopeId &&
    receipt.actorParticipantId === batch.actorParticipantId &&
    receipt.operationKey === expected.operationKey &&
    receipt.httpStatus === expected.httpStatus &&
    receipt.resourceId === batch.sourceId
  );
}

export function findInvalidBatches(history) {
  const sourceBatchCounts = new Map();
  for (const batch of history.batches) {
    if (!['EXPENSE', 'SETTLEMENT'].includes(batch.batchType)) continue;
    const key = `${batch.batchType}:${batch.sourceType}:${batch.sourceId}:${batch.sourceRevisionId}`;
    sourceBatchCounts.set(key, (sourceBatchCounts.get(key) ?? 0) + 1);
  }
  return history.batches.flatMap((batch) => {
    try {
      const postings = Array.isArray(batch.postings) ? batch.postings : [];
      const amounts = postings.map((posting) => decimalToBigInt(posting.amountMinor));
      const total = amounts.reduce((sum, amount) => sum + amount, 0n);
      const uniqueIds = new Set(postings.map((posting) => posting.id)).size === postings.length;
      const uniqueParticipants =
        new Set(postings.map((posting) => posting.participantId)).size === postings.length;
      const uniqueOrders =
        new Set(postings.map((posting) => posting.postingOrder)).size === postings.length;
      const withinBounds = amounts.every((amount) => amount !== 0n && withinMinorBounds(amount));
      const validIdentity =
        typeof batch.contextId === 'string' && /^[A-Z]{3}$/u.test(batch.currencyCode);
      const expectedEffect = expectedBatchEffect(batch, history);
      const validSourceEffect = Boolean(
        expectedEffect && mapsEqual(postingMap(batch), expectedEffect),
      );
      const validReceipt = validIdempotencyReceipt(batch, history);
      const sourceKey = `${batch.batchType}:${batch.sourceType}:${batch.sourceId}:${batch.sourceRevisionId}`;
      const uniqueSourceBatch =
        batch.batchType === 'REVERSAL' || sourceBatchCounts.get(sourceKey) === 1;
      const reversed =
        batch.batchType === 'REVERSAL' ? history.batchById.get(batch.reversesBatchId) : undefined;
      const validReversal =
        batch.batchType === 'REVERSAL'
          ? Boolean(
              reversed &&
              reversed.batchType !== 'REVERSAL' &&
              reversed.contextId === batch.contextId &&
              reversed.currencyCode === batch.currencyCode &&
              reversed.sourceType === batch.sourceType &&
              reversed.sourceId === batch.sourceId &&
              reversed.sourceRevisionId === batch.sourceRevisionId &&
              mapsEqual(postingMap(batch), postingMap(reversed), -1n),
            )
          : batch.reversesBatchId === undefined;
      if (
        postings.length >= 2 &&
        total === 0n &&
        uniqueIds &&
        uniqueParticipants &&
        uniqueOrders &&
        withinBounds &&
        validIdentity &&
        validSourceEffect &&
        validReceipt &&
        uniqueSourceBatch &&
        validReversal
      ) {
        return [];
      }
      return [
        {
          batchId: String(batch._id),
          postingCount: postings.length,
          postingSum: total.toString(),
          uniqueIds,
          uniqueParticipants,
          uniqueOrders,
          withinBounds,
          validIdentity,
          validSourceEffect,
          validReceipt,
          uniqueSourceBatch,
          validReversal,
        },
      ];
    } catch (error) {
      return [{ batchId: String(batch._id), invalidAmountOrShape: String(error) }];
    }
  });
}

function addBilateralEffect(expected, values) {
  if (values.debtorParticipantId === values.creditorParticipantId) {
    throw new Error('A bilateral financial effect uses the same participant on both sides');
  }
  const debtorIsLow = values.debtorParticipantId < values.creditorParticipantId;
  const participantLowId = debtorIsLow ? values.debtorParticipantId : values.creditorParticipantId;
  const participantHighId = debtorIsLow ? values.creditorParticipantId : values.debtorParticipantId;
  const signedAmount = debtorIsLow ? values.amountMinor : -values.amountMinor;
  const row = {
    contextId: values.contextId,
    participantLowId,
    participantHighId,
    currencyCode: values.currencyCode,
  };
  const key = bilateralProjectionKey(row);
  const previous = expected.get(key);
  expected.set(key, {
    ...row,
    lowOwesHighMinor: (previous?.lowOwesHighMinor ?? 0n) + signedAmount,
    version: (previous?.version ?? 0) + 1,
  });
}

export function loadExpectedBilaterals(history) {
  const expected = new Map();
  for (const batch of history.batches) {
    if (batch.batchType === 'EXPENSE' || batch.batchType === 'REVERSAL') {
      const sourceBatch =
        batch.batchType === 'REVERSAL' ? history.batchById.get(batch.reversesBatchId) : batch;
      const revision = sourceBatch
        ? history.expenseRevisionById.get(sourceBatch.sourceRevisionId)
        : undefined;
      if (!revision) throw new Error(`Expense revision is missing for ledger batch ${batch._id}`);
      for (const obligation of revision.obligations) {
        const amount = decimalToBigInt(obligation.amountMinor);
        addBilateralEffect(expected, {
          contextId: batch.contextId,
          currencyCode: batch.currencyCode,
          debtorParticipantId: obligation.debtorParticipantId,
          creditorParticipantId: obligation.creditorParticipantId,
          amountMinor: batch.batchType === 'REVERSAL' ? -amount : amount,
        });
      }
      continue;
    }
    if (batch.batchType === 'SETTLEMENT') {
      const settlement = history.settlementById.get(batch.sourceId);
      if (!settlement) throw new Error(`Settlement is missing for ledger batch ${batch._id}`);
      addBilateralEffect(expected, {
        contextId: batch.contextId,
        currencyCode: batch.currencyCode,
        debtorParticipantId: settlement.senderParticipantId,
        creditorParticipantId: settlement.recipientParticipantId,
        amountMinor: -decimalToBigInt(settlement.amountMinor),
      });
    }
  }
  const outOfBounds = [...expected.values()].filter(
    (row) => !withinMinorBounds(row.lowOwesHighMinor),
  );
  if (outOfBounds.length > 0) {
    throw new Error(
      'The journal produces bilateral projections outside the signed 19-digit bound',
      {
        cause: outOfBounds,
      },
    );
  }
  return expected;
}

async function loadActualBilaterals(database, session) {
  const rows = await database
    .collection(COLLECTIONS.bilateralProjections)
    .find({}, { session })
    .toArray();
  return new Map(
    rows.map((row) => {
      const amount = decimalToBigInt(row.lowOwesHighMinor);
      const version = integerVersion(row.version);
      if (
        typeof row.contextId !== 'string' ||
        typeof row.participantLowId !== 'string' ||
        typeof row.participantHighId !== 'string' ||
        row.participantLowId >= row.participantHighId ||
        !/^[A-Z]{3}$/u.test(row.currencyCode) ||
        !withinMinorBounds(amount) ||
        version < 1
      ) {
        throw new Error(`Stored bilateral projection ${row._id} violates its invariants`);
      }
      const projection = {
        contextId: row.contextId,
        participantLowId: row.participantLowId,
        participantHighId: row.participantHighId,
        currencyCode: row.currencyCode,
        lowOwesHighMinor: amount,
        version,
      };
      return [bilateralProjectionKey(projection), projection];
    }),
  );
}

export function bilateralDifferences(expected, actual) {
  const keys = new Set([...expected.keys(), ...actual.keys()]);
  return [...keys].sort().flatMap((key) => {
    const wanted = expected.get(key);
    const found = actual.get(key);
    if (
      wanted?.lowOwesHighMinor === found?.lowOwesHighMinor &&
      wanted?.version === found?.version
    ) {
      return [];
    }
    const identity = wanted ?? found;
    return [
      {
        contextId: identity.contextId,
        participantLowId: identity.participantLowId,
        participantHighId: identity.participantHighId,
        currency: identity.currencyCode,
        expectedMinor: wanted?.lowOwesHighMinor.toString() ?? '0',
        actualMinor: found?.lowOwesHighMinor.toString() ?? '0',
        expectedVersion: wanted?.version ?? 0,
        actualVersion: found?.version ?? 0,
      },
    ];
  });
}

export async function reconcileMongoFinancials() {
  const { client, database } = await connectMongo();
  const session = client.startSession();
  let report;

  try {
    await session.withTransaction(
      async () => {
        const history = await loadFinancialHistory(database, session);
        const invalidRevisions = findInvalidExpenseRevisions(history);
        const invalidSettlements = findInvalidSettlements(history);
        const invalidBatches = findInvalidBatches(history);
        if (
          invalidRevisions.length > 0 ||
          invalidSettlements.length > 0 ||
          invalidBatches.length > 0
        ) {
          throw new Error(
            'Financial source documents or ledger batches violate journal invariants; refusing projection rebuild',
            { cause: { invalidRevisions, invalidSettlements, invalidBatches } },
          );
        }

        const expectedBalances = await loadExpectedBalances(database, session);
        const balancesBefore = await loadActualBalances(database, session);
        const balanceDifferencesBefore = balanceDifferences(expectedBalances, balancesBefore);
        const expectedBilaterals = loadExpectedBilaterals(history);
        const bilateralsBefore = await loadActualBilaterals(database, session);
        const bilateralDifferencesBefore = bilateralDifferences(
          expectedBilaterals,
          bilateralsBefore,
        );

        if (rebuild) {
          const rebuiltAt = new Date();
          const balanceProjections = [...expectedBalances.values()].map((row) => ({
            _id: projectionKey(row),
            contextId: row.contextId,
            participantId: row.participantId,
            currencyCode: row.currencyCode,
            netMinor: Decimal128.fromString(row.netMinor.toString()),
            version: row.version,
            createdAt: rebuiltAt,
            updatedAt: rebuiltAt,
          }));
          const bilateralProjections = [...expectedBilaterals.values()].map((row) => ({
            _id: bilateralProjectionKey(row),
            contextId: row.contextId,
            participantLowId: row.participantLowId,
            participantHighId: row.participantHighId,
            currencyCode: row.currencyCode,
            lowOwesHighMinor: Decimal128.fromString(row.lowOwesHighMinor.toString()),
            version: row.version,
            updatedAt: rebuiltAt,
          }));
          await database.collection(COLLECTIONS.balanceProjections).deleteMany({}, { session });
          if (balanceProjections.length > 0) {
            await database
              .collection(COLLECTIONS.balanceProjections)
              .insertMany(balanceProjections, { session });
          }
          await database.collection(COLLECTIONS.bilateralProjections).deleteMany({}, { session });
          if (bilateralProjections.length > 0) {
            await database
              .collection(COLLECTIONS.bilateralProjections)
              .insertMany(bilateralProjections, { session });
          }
          const balancesAfter = await loadActualBalances(database, session);
          const balanceDifferencesAfter = balanceDifferences(expectedBalances, balancesAfter);
          const bilateralsAfter = await loadActualBilaterals(database, session);
          const bilateralDifferencesAfter = bilateralDifferences(
            expectedBilaterals,
            bilateralsAfter,
          );
          if (balanceDifferencesAfter.length > 0 || bilateralDifferencesAfter.length > 0) {
            throw new Error('Projection rebuild did not reproduce the MongoDB journal', {
              cause: { balanceDifferencesAfter, bilateralDifferencesAfter },
            });
          }
        }

        report = {
          mode: rebuild ? 'rebuild' : 'report',
          balancedJournalBatches: true,
          validExpenseRevisions: true,
          validSettlements: true,
          validReversals: true,
          validIdempotencyReceipts: true,
          expectedBalanceRows: expectedBalances.size,
          actualBalanceRowsBefore: balancesBefore.size,
          balanceDifferencesBefore,
          expectedBilateralRows: expectedBilaterals.size,
          actualBilateralRowsBefore: bilateralsBefore.size,
          bilateralDifferencesBefore,
          rebuilt: rebuild,
        };
      },
      {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
      },
    );

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (
      !rebuild &&
      (report.balanceDifferencesBefore.length > 0 || report.bilateralDifferencesBefore.length > 0)
    ) {
      process.exitCode = 2;
    }
  } finally {
    await session.endSession();
    await client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await reconcileMongoFinancials();
}

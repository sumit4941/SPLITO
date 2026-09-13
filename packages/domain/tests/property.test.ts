import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  allocateEqual,
  allocateShares,
  assertBalancedJournalBatch,
  assertExactReversal,
  reverseJournalBatch,
  simplifyBalances,
  type JournalBatch,
} from '../src/index.js';

const RUNS = 300;

describe('financial properties', () => {
  it('every equal allocation sums to its total and is deterministic', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 1_000_000_000_000n }),
        fc.integer({ min: 1, max: 50 }),
        (totalMinor, count) => {
          const participants = Array.from({ length: count }, (_, allocationOrder) => ({
            participantId: `participant-${allocationOrder}`,
            allocationOrder,
          }));
          const first = allocateEqual(totalMinor, participants);
          const retry = allocateEqual(totalMinor, [...participants].reverse());
          expect(first).toEqual(retry);
          expect(first.allocations.reduce((sum, value) => sum + value.amountMinor, 0n)).toBe(
            totalMinor,
          );
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('every valid weighted allocation sums to its total', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 1_000_000_000n }),
        fc
          .array(fc.integer({ min: 0, max: 10_000 }), { minLength: 1, maxLength: 30 })
          .filter((weights) => weights.some((weight) => weight > 0)),
        (totalMinor, weights) => {
          const allocation = allocateShares(
            totalMinor,
            weights.map((weight, allocationOrder) => ({
              participantId: `participant-${allocationOrder}`,
              allocationOrder,
              shares: weight.toString(),
            })),
          );
          expect(allocation.allocations.reduce((sum, value) => sum + value.amountMinor, 0n)).toBe(
            totalMinor,
          );
          expect(allocation.allocations.every(({ amountMinor }) => amountMinor >= 0n)).toBe(true);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('every generated journal batch sums to zero and its reversal exactly negates it', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -1_000_000, max: 1_000_000 }), {
          minLength: 1,
          maxLength: 30,
        }),
        (generated) => {
          const amounts = generated.map(BigInt);
          amounts.push(-amounts.reduce((sum, amount) => sum + amount, 0n));
          const original: JournalBatch = {
            batchId: 'original',
            contextId: 'group-property',
            currency: 'INR',
            sourceType: 'expense',
            sourceId: 'expense-property',
            sourceRevision: 1,
            actorId: 'actor',
            occurredAt: '2026-09-12T00:00:00.000Z',
            postings: amounts.map((amountMinor, index) => ({
              participantId: `participant-${index}`,
              amountMinor,
            })),
          };
          expect(() => assertBalancedJournalBatch(original)).not.toThrow();
          const reversal = reverseJournalBatch(original, {
            batchId: 'reversal',
            sourceId: 'expense-property',
            sourceRevision: 2,
            actorId: 'actor',
            occurredAt: '2026-09-13T00:00:00.000Z',
          });
          expect(() => assertExactReversal(original, reversal)).not.toThrow();
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('simplification preserves every participant net and settles each to zero', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -100_000, max: 100_000 }), {
          minLength: 1,
          maxLength: 30,
        }),
        (generated) => {
          const nets = generated.map(BigInt);
          nets.push(-nets.reduce((sum, net) => sum + net, 0n));
          const balances = nets.map((netMinor, index) => ({
            participantId: `participant-${index}`,
            netMinor,
          }));
          const plan = simplifyBalances({
            contextId: 'group-property',
            currency: 'INR',
            balanceVersion: 'property-version',
            balances,
          });
          const remaining = new Map(
            balances.map(({ participantId, netMinor }) => [participantId, netMinor]),
          );
          for (const suggestion of plan.suggestions) {
            remaining.set(
              suggestion.fromParticipantId,
              remaining.get(suggestion.fromParticipantId)! + suggestion.amountMinor,
            );
            remaining.set(
              suggestion.toParticipantId,
              remaining.get(suggestion.toParticipantId)! - suggestion.amountMinor,
            );
          }
          expect([...remaining.values()].every((net) => net === 0n)).toBe(true);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

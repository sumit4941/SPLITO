import { describe, expect, it, vi } from 'vitest';

import {
  COLLECTIONS,
  COLLECTION_VALIDATORS,
  ensureMongoSchema,
  MONGO_INDEXES,
  REFERENCE_CURRENCIES,
} from './schema.mjs';
import { managedIndexMatches } from './runtime-readiness.mjs';

describe('MongoDB schema manifest', () => {
  it('defines one strict validator for each unique application collection', () => {
    const names = Object.values(COLLECTIONS);
    expect(names).toHaveLength(24);
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(COLLECTION_VALIDATORS).sort()).toEqual([...names].sort());

    expect(COLLECTION_VALIDATORS.expenseRevisions.$jsonSchema.properties.totalMinor.bsonType).toBe(
      'decimal',
    );
    expect(
      COLLECTION_VALIDATORS.ledgerBatches.$jsonSchema.properties.postings.items.properties
        .amountMinor.bsonType,
    ).toBe('decimal');
    expect(COLLECTION_VALIDATORS.sessions.$jsonSchema.properties.sessionTokenHash.bsonType).toBe(
      'binData',
    );
    expect(COLLECTION_VALIDATORS.auditEvents.$jsonSchema.required).toContain('actionKey');
    expect(COLLECTION_VALIDATORS.ledgerBatches.$jsonSchema.properties.postings.minItems).toBe(2);
    expect(
      COLLECTION_VALIDATORS.ledgerBatches.$jsonSchema.properties.postings.items.properties
        .postingOrder.minimum,
    ).toBe(0);
    expect(
      COLLECTION_VALIDATORS.expenseRevisions.$jsonSchema.properties.payers.items.properties.paidMinor.minimum.toString(),
    ).toBe('1');
    expect(
      COLLECTION_VALIDATORS.bilateralProjections.$jsonSchema.properties.lowOwesHighMinor.minimum.toString(),
    ).toBe('-9999999999999999999');
    expect(COLLECTION_VALIDATORS.idempotencyKeys.$jsonSchema.properties.status.enum).toEqual([
      'IN_PROGRESS',
      'COMPLETED',
    ]);
    expect(COLLECTION_VALIDATORS.idempotencyKeys.$jsonSchema.oneOf).toHaveLength(2);
    expect(COLLECTION_VALIDATORS.outbox.$jsonSchema.oneOf).toHaveLength(5);
    expect(COLLECTION_VALIDATORS.mediaObjects.$jsonSchema.oneOf).toHaveLength(2);
  });

  it('keeps the stable session, OTP, and permanent receipt indexes explicit', () => {
    const indexesFor = (collection) =>
      MONGO_INDEXES.find((entry) => entry.collection === collection)?.indexes ?? [];

    expect(indexesFor(COLLECTIONS.sessions)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'uq_session_id', unique: true }),
        expect.objectContaining({ name: 'uq_session_token', unique: true }),
      ]),
    );
    expect(indexesFor(COLLECTIONS.mobileOtpChallenges)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'uq_mobile_otp_slot', unique: true }),
        expect.objectContaining({ name: 'uq_mobile_otp_challenge_id', unique: true }),
        expect.objectContaining({ name: 'ttl_mobile_otp_retention', expireAfterSeconds: 0 }),
      ]),
    );
    expect(indexesFor(COLLECTIONS.mobileOtpThrottles)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'ttl_mobile_otp_throttle', expireAfterSeconds: 0 }),
      ]),
    );
    expect(COLLECTION_VALIDATORS.mobileOtpChallenges.$jsonSchema.required).toContain('purgeAt');
    expect(COLLECTION_VALIDATORS.mobileOtpThrottles.$jsonSchema.required).toContain('purgeAt');
    expect(indexesFor(COLLECTIONS.idempotencyReceipts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'ix_idempotency_receipt_scope' }),
        expect.objectContaining({ name: 'ix_idempotency_receipt_resource' }),
      ]),
    );
    expect(indexesFor(COLLECTIONS.ledgerBatches)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'uq_expense_source_revision', unique: true }),
        expect.objectContaining({ name: 'uq_settlement_source_revision', unique: true }),
      ]),
    );
  });

  it('detects unexpected partial, unique, and TTL options on managed indexes', () => {
    const expected = { key: { contextId: 1 }, name: 'ix_context' };
    expect(managedIndexMatches(expected, { key: { contextId: 1 }, name: 'ix_context' })).toBe(true);
    expect(
      managedIndexMatches(expected, {
        key: { contextId: 1 },
        name: 'ix_context',
        partialFilterExpression: { status: 'ACTIVE' },
      }),
    ).toBe(false);
    expect(managedIndexMatches(expected, { ...expected, unique: true })).toBe(false);
    expect(managedIndexMatches(expected, { ...expected, expireAfterSeconds: 0 })).toBe(false);
    expect(managedIndexMatches(expected, { ...expected, sparse: true })).toBe(false);
    expect(managedIndexMatches(expected, { ...expected, collation: { locale: 'en' } })).toBe(false);
  });

  it('contains unique reference currencies keyed by their code', () => {
    expect(new Set(REFERENCE_CURRENCIES.map(({ code }) => code)).size).toBe(
      REFERENCE_CURRENCIES.length,
    );
    for (const currency of REFERENCE_CURRENCIES) {
      expect(currency._id).toBe(currency.code);
      expect(currency.active).toBe(true);
    }
  });

  it('creates missing collections and modifies existing validators before indexes', async () => {
    const existingName = COLLECTIONS.users;
    const createCollection = vi.fn().mockResolvedValue(undefined);
    const command = vi.fn().mockResolvedValue({ ok: 1 });
    const createIndexes = vi.fn().mockResolvedValue([]);
    const database = {
      listCollections: vi.fn(() => ({
        toArray: vi.fn().mockResolvedValue([{ name: existingName }]),
      })),
      createCollection,
      command,
      collection: vi.fn(() => ({ createIndexes })),
    };

    await ensureMongoSchema(database);

    expect(command).toHaveBeenCalledWith({
      collMod: existingName,
      validator: COLLECTION_VALIDATORS[existingName],
      validationLevel: 'strict',
      validationAction: 'error',
    });
    expect(createCollection).toHaveBeenCalledTimes(Object.keys(COLLECTIONS).length - 1);
    expect(createCollection).toHaveBeenCalledWith(
      COLLECTIONS.currencies,
      expect.objectContaining({
        validator: COLLECTION_VALIDATORS.currencies,
        validationLevel: 'strict',
        validationAction: 'error',
      }),
    );
    expect(createIndexes).toHaveBeenCalledTimes(MONGO_INDEXES.length);
  });
});

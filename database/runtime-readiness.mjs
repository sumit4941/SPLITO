import { createHash } from 'node:crypto';
import {
  COLLECTIONS,
  COLLECTION_VALIDATORS,
  MONGO_INDEXES,
  REFERENCE_CURRENCIES,
  SCHEMA_MIGRATIONS_COLLECTION,
  SCHEMA_VERSION,
} from './schema.mjs';

export const MONGO_SCHEMA_DEFINITION_CHECKSUM = createHash('sha256')
  .update(
    JSON.stringify({
      collections: COLLECTIONS,
      validators: COLLECTION_VALIDATORS,
      indexes: MONGO_INDEXES,
      referenceCurrencies: REFERENCE_CURRENCIES,
    }),
  )
  .digest('hex');

function notReady(reason) {
  return new Error(`MongoDB schema is not ready: ${reason}. Run npm run db:migrate first`);
}

function canonicalJson(value) {
  if (value?._bsontype === 'Decimal128')
    return JSON.stringify({ $numberDecimal: value.toString() });
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const MANAGED_INDEX_PROPERTIES = [
  'key',
  'unique',
  'partialFilterExpression',
  'expireAfterSeconds',
  'sparse',
  'collation',
  'hidden',
];

function normalizedIndexProperty(index, property) {
  if (property === 'unique' || property === 'sparse' || property === 'hidden') {
    return index?.[property] === true;
  }
  return index?.[property] ?? null;
}

export function managedIndexMatches(expected, actual) {
  if (!actual) return false;
  return MANAGED_INDEX_PROPERTIES.every(
    (property) =>
      canonicalJson(normalizedIndexProperty(actual, property)) ===
      canonicalJson(normalizedIndexProperty(expected, property)),
  );
}

export async function assertMongoRuntimeReady(
  database,
  component,
  { verifyManagedSchema = false } = {},
) {
  const hello = await database.admin().command({ hello: 1 });
  if (typeof hello.setName !== 'string' && hello.msg !== 'isdbgrid') {
    throw notReady('a replica set or sharded cluster is required for transactions');
  }

  const migration = await database.collection(SCHEMA_MIGRATIONS_COLLECTION).findOne(
    {
      _id: SCHEMA_VERSION,
      name: 'mongodb-application-baseline',
      checksum: MONGO_SCHEMA_DEFINITION_CHECKSUM,
    },
    { projection: { _id: 1, appliedAt: 1 } },
  );
  if (!migration || !(migration.appliedAt instanceof Date)) {
    throw notReady(`schema version ${SCHEMA_VERSION} does not match this application build`);
  }

  const requiredCollections =
    component === 'worker' ? [COLLECTIONS.outbox] : Object.values(COLLECTIONS);
  const collectionRows = await database
    .listCollections(
      { name: { $in: requiredCollections } },
      { nameOnly: !verifyManagedSchema, authorizedCollections: true },
    )
    .toArray();
  const installedCollections = new Set(collectionRows.map(({ name }) => name));
  const missingCollections = requiredCollections.filter((name) => !installedCollections.has(name));
  if (missingCollections.length > 0) {
    throw notReady(`required collections are missing for ${component}`);
  }

  if (verifyManagedSchema) {
    const collectionsByName = new Map(
      collectionRows.map((definition) => [definition.name, definition]),
    );
    const validatorDrift = requiredCollections.some((name) => {
      const actual = collectionsByName.get(name)?.options;
      return (
        canonicalJson(actual?.validator) !== canonicalJson(COLLECTION_VALIDATORS[name]) ||
        actual?.validationLevel !== 'strict' ||
        actual?.validationAction !== 'error'
      );
    });
    if (validatorDrift) throw notReady(`managed validators drifted for ${component}`);

    for (const definition of MONGO_INDEXES.filter(({ collection }) =>
      requiredCollections.includes(collection),
    )) {
      const actualByName = new Map(
        (await database.collection(definition.collection).listIndexes().toArray()).map((index) => [
          index.name,
          index,
        ]),
      );
      const indexDrift = definition.indexes.some((expected) => {
        const actual = actualByName.get(expected.name);
        return !managedIndexMatches(expected, actual);
      });
      if (indexDrift) throw notReady(`managed indexes drifted for ${component}`);
    }
  }

  if (component === 'api') {
    const requiredCurrencyCodes = REFERENCE_CURRENCIES.map(({ code }) => code);
    const currencies = await database
      .collection(COLLECTIONS.currencies)
      .find(
        { _id: { $in: requiredCurrencyCodes } },
        { projection: { _id: 1, code: 1, minorUnits: 1, active: 1 } },
      )
      .toArray();
    const installed = new Map(currencies.map((currency) => [currency._id, currency]));
    const incomplete = REFERENCE_CURRENCIES.some(({ code, minorUnits }) => {
      const currency = installed.get(code);
      return (
        !currency ||
        currency.code !== code ||
        currency.minorUnits !== minorUnits ||
        !currency.active
      );
    });
    if (incomplete) throw notReady('reference currencies are incomplete');
  }
}

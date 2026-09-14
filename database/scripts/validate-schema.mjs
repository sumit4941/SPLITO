import { connectMongo } from '../lib/mongodb-env.mjs';
import { managedIndexMatches, MONGO_SCHEMA_DEFINITION_CHECKSUM } from '../runtime-readiness.mjs';
import {
  COLLECTIONS,
  COLLECTION_VALIDATORS,
  MONGO_INDEXES,
  REFERENCE_CURRENCIES,
  SCHEMA_MIGRATIONS_COLLECTION,
  SCHEMA_VERSION,
} from '../schema.mjs';

const { client, database } = await connectMongo();

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

try {
  const collectionDefinitions = await database.listCollections({}, { nameOnly: false }).toArray();
  const collectionsByName = new Map(
    collectionDefinitions.map((definition) => [definition.name, definition]),
  );
  const requiredCollections = [...Object.values(COLLECTIONS), SCHEMA_MIGRATIONS_COLLECTION];
  const missingCollections = requiredCollections.filter((name) => !collectionsByName.has(name));
  if (missingCollections.length > 0) {
    throw new Error(`Missing MongoDB collections: ${missingCollections.join(', ')}`);
  }

  const mismatchedValidators = Object.entries(COLLECTION_VALIDATORS).flatMap(([name, expected]) => {
    const options = collectionsByName.get(name)?.options;
    if (
      canonicalJson(options?.validator) === canonicalJson(expected) &&
      options?.validationLevel === 'strict' &&
      options?.validationAction === 'error'
    ) {
      return [];
    }
    return [name];
  });
  if (mismatchedValidators.length > 0) {
    throw new Error(`Mismatched MongoDB collection validators: ${mismatchedValidators.join(', ')}`);
  }

  const missingIndexes = [];
  const mismatchedIndexes = [];
  for (const definition of MONGO_INDEXES) {
    const actualByName = new Map(
      (await database.collection(definition.collection).listIndexes().toArray()).map((index) => [
        index.name,
        index,
      ]),
    );

    for (const expected of definition.indexes) {
      const actual = actualByName.get(expected.name);
      if (!actual) {
        missingIndexes.push(`${definition.collection}.${expected.name}`);
        continue;
      }

      if (!managedIndexMatches(expected, actual)) {
        mismatchedIndexes.push(`${definition.collection}.${expected.name}`);
      }
    }
  }

  if (missingIndexes.length > 0) {
    throw new Error(`Missing MongoDB indexes: ${missingIndexes.join(', ')}`);
  }
  if (mismatchedIndexes.length > 0) {
    throw new Error(`Mismatched MongoDB indexes: ${mismatchedIndexes.join(', ')}`);
  }

  const migration = await database.collection(SCHEMA_MIGRATIONS_COLLECTION).findOne({
    _id: SCHEMA_VERSION,
    name: 'mongodb-application-baseline',
    checksum: MONGO_SCHEMA_DEFINITION_CHECKSUM,
  });
  if (!migration || !(migration.appliedAt instanceof Date)) {
    throw new Error(
      `MongoDB schema migration ${SCHEMA_VERSION} does not match this application build`,
    );
  }

  const expectedCurrencies = new Map(
    REFERENCE_CURRENCIES.map((currency) => [currency._id, currency]),
  );
  const actualCurrencies = await database
    .collection(COLLECTIONS.currencies)
    .find(
      { _id: { $in: [...expectedCurrencies.keys()] } },
      { projection: { _id: 1, code: 1, displayName: 1, symbol: 1, minorUnits: 1, active: 1 } },
    )
    .toArray();
  const currenciesByCode = new Map(actualCurrencies.map((currency) => [currency._id, currency]));
  const mismatchedCurrencies = [...expectedCurrencies].flatMap(([code, expected]) => {
    const actual = currenciesByCode.get(code);
    return actual && canonicalJson(actual) === canonicalJson(expected) ? [] : [code];
  });
  if (mismatchedCurrencies.length > 0) {
    throw new Error(`Mismatched MongoDB reference currencies: ${mismatchedCurrencies.join(', ')}`);
  }

  const indexCount = MONGO_INDEXES.reduce((total, entry) => total + entry.indexes.length, 0);
  process.stdout.write(
    `MongoDB schema is valid: ${Object.keys(COLLECTIONS).length} validated application collections and ${indexCount} managed indexes.\n`,
  );
} finally {
  await client.close();
}

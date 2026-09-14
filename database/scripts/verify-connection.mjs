import { connectMongo } from '../lib/mongodb-env.mjs';

const { client, database } = await connectMongo();

try {
  const hello = await database.admin().command({ hello: 1 });
  const transactionCapable = Boolean(hello.setName) || hello.msg === 'isdbgrid';
  if (!transactionCapable) {
    throw new Error('MongoDB must be a replica set or sharded cluster; standalone is unsupported');
  }
  const topology = hello.setName ? `replica set ${String(hello.setName)}` : 'sharded cluster';

  const session = client.startSession();
  try {
    await session.withTransaction(
      () => database.collection('schemaMigrations').findOne({}, { session }),
      {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
      },
    );
  } finally {
    await session.endSession();
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        database: database.databaseName,
        topology,
        writablePrimary: hello.isWritablePrimary === true,
        maxWireVersion: hello.maxWireVersion,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await client.close();
}

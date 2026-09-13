import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '..', '..');
const sourceUrl = process.env.SPLITO_OPENAPI_URL ?? 'http://127.0.0.1:3000/api/openapi.json';

const response = await fetch(sourceUrl, { headers: { accept: 'application/json' } });
if (!response.ok) {
  throw new Error(`OpenAPI fetch failed with HTTP ${response.status} from ${sourceUrl}`);
}

const document = await response.json();
if (
  typeof document !== 'object' ||
  document === null ||
  !('openapi' in document) ||
  !('paths' in document)
) {
  throw new Error('The API returned an invalid OpenAPI document');
}

const docsPath = resolve(repositoryRoot, 'docs', 'openapi.json');
const schemaPath = resolve(packageRoot, 'src', 'schema.ts');
await mkdir(dirname(docsPath), { recursive: true });
await mkdir(dirname(schemaPath), { recursive: true });
await writeFile(docsPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

const nodes = await openapiTS(document, {
  alphabetize: true,
  defaultNonNullable: false,
  rootTypes: true,
});
await writeFile(
  schemaPath,
  `/* This file is generated from docs/openapi.json. Do not edit by hand. */\n${astToString(nodes)}`,
  'utf8',
);

const pathCount = Object.keys(document.paths).length;
const schemaCount = Object.keys(document.components?.schemas ?? {}).length;
process.stdout.write(
  `Generated SPLITO client types from ${pathCount} paths and ${schemaCount} schemas.\n`,
);

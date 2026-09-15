import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { validateStaticFields } from '@vercel/config/v1';

const testApiOrigin = 'https://api.example.com';
const previousApiOrigin = process.env.SPLITO_API_ORIGIN;
process.env.SPLITO_API_ORIGIN = testApiOrigin;
const { config } = await import('../vercel.ts');
if (previousApiOrigin === undefined) delete process.env.SPLITO_API_ORIGIN;
else process.env.SPLITO_API_ORIGIN = previousApiOrigin;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid Vercel configuration: ${message}`);
}

validateStaticFields(config as Record<string, unknown>);

const rewrites = config.rewrites ?? [];
invariant(rewrites.length === 2, 'expected the API proxy followed by the SPA fallback');

const [apiRewrite, spaFallback] = rewrites;
invariant(apiRewrite, 'API rewrite is missing');
invariant(apiRewrite.source === '/api/:path*', 'API rewrite source changed unexpectedly');
invariant(
  apiRewrite.destination === `${testApiOrigin}/api/:path*`,
  'API rewrite destination must contain the validated build-time origin',
);
invariant(
  apiRewrite.env === undefined,
  'API rewrite must not defer origin substitution to the routing layer',
);

invariant(spaFallback, 'SPA fallback is missing');
invariant(spaFallback.source === '/(.*)', 'SPA fallback must be the final catch-all rewrite');
invariant(spaFallback.destination === '/index.html', 'SPA fallback must serve index.html');

invariant(config.framework === 'vite', 'framework must be Vite');
invariant(config.buildCommand === 'npm run build:vercel', 'unexpected build command');
invariant(config.outputDirectory === 'apps/web/dist', 'unexpected output directory');

const environmentValidator = fileURLToPath(new URL('./validate-vercel-env.mjs', import.meta.url));
const backendOnlyVariables = [
  'API_HOST',
  'API_PORT',
  'WEB_ORIGIN',
  'TRUST_PROXY',
  'MONGODB_URI',
  'MONGODB_DATABASE',
  'MONGODB_MIN_POOL_SIZE',
  'MONGODB_MAX_POOL_SIZE',
  'MONGODB_CONNECT_TIMEOUT_MS',
  'MONGODB_SERVER_SELECTION_TIMEOUT_MS',
  'MONGODB_SOCKET_TIMEOUT_MS',
  'SESSION_PEPPER',
  'CSRF_SECRET',
  'OTP_PEPPER',
  'MFA_ENCRYPTION_KEY',
  'COOKIE_SECURE',
  'COOKIE_DOMAIN',
  'ATTACHMENT_STORAGE_PATH',
  'OUTBOX_POLL_MS',
  'OUTBOX_LEASE_SECONDS',
  'OUTBOX_MAX_ATTEMPTS',
  'SMS_PROVIDER',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_API_KEY_SID',
  'TWILIO_API_KEY_SECRET',
  'TWILIO_FROM_E164',
  'TWILIO_MESSAGING_SERVICE_SID',
] as const;
const cleanEnvironment = { ...process.env };
for (const name of [...backendOnlyVariables, 'VITE_API_BASE_URL'] as const) {
  delete cleanEnvironment[name];
}
delete cleanEnvironment.VERCEL_URL;
delete cleanEnvironment.VERCEL_PROJECT_PRODUCTION_URL;
const originCases = [
  ['canonical HTTPS origin', 'https://api.example.com', true],
  ['missing origin', undefined, false],
  ['HTTP origin', 'http://api.example.com', false],
  ['trailing slash', 'https://api.example.com/', false],
  ['path normalized by URL', 'https://api.example.com/.', false],
  ['empty query marker', 'https://api.example.com?', false],
  ['empty fragment marker', 'https://api.example.com#', false],
  ['localhost', 'https://localhost:3000', false],
  ['localhost with a trailing dot', 'https://localhost.:3000', false],
  ['single-label hostname', 'https://api', false],
  ['loopback address', 'https://127.0.0.1:3000', false],
  ['public literal address', 'https://8.8.8.8', false],
  ['private address', 'https://192.168.1.10:3000', false],
  ['IPv4-mapped private IPv6 address', 'https://[::ffff:127.0.0.1]:3000', false],
] as const;

for (const [name, origin, shouldPass] of originCases) {
  const env = { ...cleanEnvironment };
  if (origin === undefined) delete env.SPLITO_API_ORIGIN;
  else env.SPLITO_API_ORIGIN = origin;

  const result = spawnSync(process.execPath, [environmentValidator], {
    encoding: 'utf8',
    env,
  });
  invariant(result.error === undefined, `${name} validation could not run`);
  invariant(
    result.status === (shouldPass ? 0 : 1),
    `${name} validation returned ${String(result.status)}: ${(result.stderr || result.stdout).trim()}`,
  );
}

const isolationCases = [
  ['MongoDB URI in web project', { MONGODB_URI: 'mongodb+srv://example.invalid/' }],
  ['browser API override', { VITE_API_BASE_URL: 'https://api.example.com/api/v1' }],
  ['recursive production origin', { VERCEL_PROJECT_PRODUCTION_URL: 'api.example.com' }],
  ['recursive branch origin', { VERCEL_BRANCH_URL: 'api.example.com' }],
] as const;

for (const [name, injected] of isolationCases) {
  const result = spawnSync(process.execPath, [environmentValidator], {
    encoding: 'utf8',
    env: {
      ...cleanEnvironment,
      SPLITO_API_ORIGIN: 'https://api.example.com',
      ...injected,
    },
  });
  invariant(result.error === undefined, `${name} validation could not run`);
  invariant(result.status === 1, `${name} must fail closed`);
}

console.log('Vercel configuration is valid.');

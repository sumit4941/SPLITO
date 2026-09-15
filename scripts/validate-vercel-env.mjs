import { isIP } from 'node:net';

const configuredApiOrigin = process.env.SPLITO_API_ORIGIN;
const apiOrigin = configuredApiOrigin?.trim();

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
];

function fail(message) {
  console.error(`Vercel configuration error: ${message}`);
  process.exitCode = 1;
}

function isNonPublicHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (
    normalized.endsWith('.') ||
    !normalized.includes('.') ||
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal')
  ) {
    return true;
  }

  // Require a DNS name. Literal IP origins are brittle on managed hosting and
  // make comprehensive private/reserved-address validation easy to bypass.
  return isIP(normalized) !== 0;
}

const misplacedVariables = backendOnlyVariables.filter((name) => Object.hasOwn(process.env, name));
if (misplacedVariables.length > 0) {
  fail(
    `remove backend-only variables from the Vercel web project: ${misplacedVariables.join(', ')}. Configure them only on the API or worker host.`,
  );
}

if (Object.hasOwn(process.env, 'VITE_API_BASE_URL')) {
  fail('VITE_API_BASE_URL must remain unset so browser requests use the same-origin /api proxy.');
}

if (!apiOrigin) {
  fail('SPLITO_API_ORIGIN is required.');
} else if (configuredApiOrigin !== apiOrigin) {
  fail('SPLITO_API_ORIGIN must not contain leading or trailing whitespace.');
} else {
  try {
    const parsed = new URL(apiOrigin);
    const isOriginOnly =
      parsed.protocol === 'https:' &&
      apiOrigin === parsed.origin &&
      parsed.pathname === '/' &&
      parsed.search === '' &&
      parsed.hash === '' &&
      parsed.username === '' &&
      parsed.password === '';

    if (!isOriginOnly) throw new Error('invalid origin');
    if (isNonPublicHostname(parsed.hostname)) throw new Error('non-public origin');

    const vercelHosts = [
      process.env.VERCEL_URL,
      process.env.VERCEL_BRANCH_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
    ]
      .map((host) => host?.trim().toLowerCase())
      .filter(Boolean);
    if (vercelHosts.includes(parsed.host.toLowerCase())) {
      throw new Error('recursive origin');
    }
    console.log('Vercel backend origin is valid.');
  } catch (error) {
    if (error instanceof Error && error.message === 'recursive origin') {
      fail('SPLITO_API_ORIGIN must not point back to this Vercel web project.');
    } else if (error instanceof Error && error.message === 'non-public origin') {
      fail('SPLITO_API_ORIGIN must use a publicly reachable hostname.');
    } else {
      fail(
        'SPLITO_API_ORIGIN must be a canonical HTTPS origin without credentials, a trailing slash, a path, a query, or a fragment.',
      );
    }
  }
}

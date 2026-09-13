const configuredApiOrigin = process.env.SPLITO_API_ORIGIN;
const apiOrigin = configuredApiOrigin?.trim();

function fail(message) {
  console.error(`Vercel configuration error: ${message}`);
  process.exitCode = 1;
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
    console.log('Vercel backend origin is valid.');
  } catch {
    fail(
      'SPLITO_API_ORIGIN must be a canonical HTTPS origin without credentials, a trailing slash, a path, a query, or a fragment.',
    );
  }
}

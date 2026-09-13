const rawApiOrigin = process.env.SPLITO_API_ORIGIN?.trim();

if (!rawApiOrigin) {
  throw new Error('SPLITO_API_ORIGIN is required for Vercel deployments.');
}

let apiOrigin;
try {
  const parsed = new URL(rawApiOrigin);
  const isOriginOnly =
    parsed.pathname === '/' &&
    parsed.search === '' &&
    parsed.hash === '' &&
    parsed.username === '' &&
    parsed.password === '';

  if (parsed.protocol !== 'https:' || !isOriginOnly) throw new Error('invalid origin');
  apiOrigin = parsed.origin;
} catch {
  throw new Error(
    'SPLITO_API_ORIGIN must be an HTTPS origin without credentials, a path, a query, or a fragment.',
  );
}

export const config = {
  framework: 'vite',
  installCommand: 'npm ci',
  buildCommand: 'npm run build:vercel',
  outputDirectory: 'apps/web/dist',
  rewrites: [
    {
      source: '/api/:path*',
      destination: `${apiOrigin}/api/:path*`,
    },
    {
      source: '/(.*)',
      destination: '/index.html',
    },
  ],
  headers: [
    {
      source: '/api/:path*',
      headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
    },
    {
      source: '/assets/:path*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    },
    {
      source: '/sw.js',
      headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
    },
    {
      source: '/manifest.webmanifest',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
    },
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=()' },
        {
          key: 'Content-Security-Policy',
          value:
            "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: blob:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https: wss:; manifest-src 'self'; worker-src 'self' blob:",
        },
      ],
    },
  ],
};

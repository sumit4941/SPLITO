import { deploymentEnv, routes, type VercelConfig } from '@vercel/config/v1';

const apiOrigin = deploymentEnv('SPLITO_API_ORIGIN');

export const config: VercelConfig = {
  framework: 'vite',
  installCommand: 'npm ci',
  buildCommand: 'npm run build:vercel',
  outputDirectory: 'apps/web/dist',
  rewrites: [
    routes.rewrite('/api/:path*', `${apiOrigin}/api/:path*`),
    routes.rewrite('/(.*)', '/index.html'),
  ],
  headers: [
    routes.header('/api/:path*', [{ key: 'Cache-Control', value: 'private, no-store' }]),
    routes.header('/assets/:path*', [
      { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
    ]),
    routes.header('/sw.js', [
      { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
    ]),
    routes.header('/manifest.webmanifest', [
      { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
    ]),
    routes.header('/(.*)', [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=()' },
      {
        key: 'Content-Security-Policy',
        value:
          "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: blob:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https: wss:; manifest-src 'self'; worker-src 'self' blob:",
      },
    ]),
  ],
};

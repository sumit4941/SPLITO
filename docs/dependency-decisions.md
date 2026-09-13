# Dependency decisions

Decision date: 2026-09-12. Direct dependencies are exact versions in workspace
manifests and transitive resolution is pinned by `package-lock.json`. Automated
weekly proposals do not merge without CI and compatibility review.

## Runtime/toolchain

| Component      | Selected                                                 | Rationale                                                                                                                                                                                                                                          |
| -------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js        | 24 LTS; CI/images `24.21.0`                              | Current supported LTS line. The inspected machine has 24.13.0 and should update within the same major for parity. Node 26 remains Current, not the production LTS choice.                                                                          |
| npm            | 11.6.2 package manager declaration                       | Installed and workspace-capable; lockfile installs use `npm ci`.                                                                                                                                                                                   |
| TypeScript     | 6.0.3; generator exception 5.9.3                         | 6.0.3 is the newest root/application selection compatible with `typescript-eslint` 8.70.0 (`<6.1.0`). `packages/api-client` alone pins 5.9.3 because `openapi-typescript` 7.13.0 declares a TypeScript `^5.x` peer. TypeScript 7.0.2 was rejected. |
| ESLint/tooling | ESLint 10.10.0, typescript-eslint 8.70.0, Prettier 3.9.6 | Exact direct pins; CI treats warnings as failures.                                                                                                                                                                                                 |
| Tests          | Vitest 5.0.0, fast-check 4.10.0, Playwright 1.63.0       | Unit/property/browser coverage without mixing runners.                                                                                                                                                                                             |

[Node’s release policy](https://nodejs.org/en/about/previous-releases) recommends
production on Active or Maintenance LTS. Container tags are exact patch tags and
still require release-date image vulnerability scanning.

## Backend

| Component                                   | Selected                                                                       | Rationale/compatibility note                                                                                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| NestJS common/core/platform-fastify/swagger | 12.0.1                                                                         | Same release family avoids decorator/platform skew.                                                                                                                                                                |
| Fastify                                     | 5.12.1                                                                         | `@nestjs/platform-fastify` 12.0.1 resolves/pins this version. Registry-latest 5.12.4 produced duplicate Fastify type universes and plugin incompatibility, so 5.12.1 is the newest mutually compatible direct pin. |
| Fastify plugins                             | cookie 11.1.2, cors 11.3.0, helmet 13.1.1, multipart 10.1.1, rate-limit 11.2.0 | Maintained Fastify-native packages; no Express middleware. Must remain peer-compatible with Fastify 5.12.1.                                                                                                        |
| node-oracledb                               | 7.0.1                                                                          | Official driver; Thin mode supports Oracle 12.1+ and the observed 26ai server. Money NUMBER values are fetched as strings.                                                                                         |
| Argon2                                      | 0.45.1                                                                         | Standard Argon2id implementation; deployment needs a supported native build and tuned memory/time benchmarks.                                                                                                      |
| Sharp                                       | 0.35.4                                                                         | Bounded JPEG/PNG/WebP decoding plus orientation-aware, metadata-stripped WebP normalization for profile/group images. Native libvips builds must remain pinned, audited, and tested on every deployment platform.  |
| Zod                                         | 4.6.2                                                                          | Shared strict runtime validation.                                                                                                                                                                                  |
| Pino                                        | 10.3.1                                                                         | Structured logging with explicit sensitive-field redaction.                                                                                                                                                        |

## Frontend

| Concern            | Selected versions                                                              |
| ------------------ | ------------------------------------------------------------------------------ |
| UI/runtime         | React/React DOM 19.3.0, React Router DOM 7.18.3                                |
| Server/forms       | TanStack Query 5.102.8, React Hook Form 7.88.0, resolvers 5.9.1, Zod 4.6.2     |
| Build/PWA/styles   | Vite 8.3.0, React plugin 6.1.1, Tailwind CSS/Vite 4.3.3, vite-plugin-pwa 1.3.0 |
| Components/visuals | Radix Dialog 1.1.23, Slot 1.3.3, Lucide 1.45.0, Motion 13.2.0, Recharts 3.10.1 |
| Local/i18n         | Dexie 4.4.6, i18next 26.4.2, react-i18next 17.0.13                             |

Charts require table alternatives, animation honors reduced motion, and the
service worker must not cache general authenticated API responses. Dexie stores
only explicit per-account offline data.

## Images and update policy

Production Dockerfiles use Node `24.21.0-bookworm-slim`; static delivery uses
NGINX `1.30.4-alpine`. Exact tags improve repeatability but tags are mutable;
release automation should resolve, record, scan, sign, and deploy immutable
digests. Oracle CI uses the exact supported 26ai-compatible
`gvenzl/oracle-free:23.26.3-slim-faststart` test image, pinned to its
`linux/amd64` digest, rather than its rolling `23` alias. Dependabot monitors npm,
GitHub Actions, and Docker definitions
weekly.

Before accepting an update, check official release notes, Node engines, peer
dependencies, Nest/Fastify plugin compatibility, native Argon2/oracledb support,
lockfile diff, license change, vulnerabilities, Oracle integration, browser tests,
and financial properties. No production dependency is configured as unrestricted
`latest`, and prereleases require an explicit decision record.

References:

- [node-oracledb installation/support matrix](https://node-oracledb.readthedocs.io/en/latest/user_guide/installation.html)
- [node-oracledb Thin/Thick initialization](https://node-oracledb.readthedocs.io/en/stable/user_guide/initialization.html)
- [Oracle Free test-image supported tags](https://github.com/gvenzl/oci-oracle-free#supported-tags)
- [GitHub Dependabot configuration](https://docs.github.com/en/code-security/concepts/supply-chain-security/about-the-dependabot-yml-file)

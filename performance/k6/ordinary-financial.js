import http from 'k6/http';
import { check, fail, sleep } from 'k6';

const baseUrl = (__ENV.SPLITO_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/u, '');
const email = __ENV.SPLITO_LOAD_EMAIL || 'alice@splito.example';
const password = __ENV.SPLITO_LOAD_PASSWORD || 'SplitoDemo!2026'; // gitleaks:allow
const groupId = __ENV.SPLITO_LOAD_GROUP_ID || '40000000-0000-0000-0000-000000000001';
const participantIds = (
  __ENV.SPLITO_LOAD_PARTICIPANT_IDS ||
  '20000000-0000-0000-0000-000000000001,20000000-0000-0000-0000-000000000002,20000000-0000-0000-0000-000000000003'
).split(',');

export const options = {
  scenarios: {
    ordinary_financial: {
      executor: 'constant-vus',
      vus: Number(__ENV.SPLITO_LOAD_VUS || 20),
      duration: __ENV.SPLITO_LOAD_DURATION || '5m',
      gracefulStop: '30s',
    },
  },
  thresholds: {
    'http_req_duration{operation:ordinary_financial}': ['p(95)<500'],
    'http_req_failed{operation:ordinary_financial}': ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

let authenticated = false;

function jsonHeaders(extra = {}) {
  return { headers: { 'content-type': 'application/json', ...extra } };
}

function authenticate() {
  const response = http.post(`${baseUrl}/api/v1/auth/login`, JSON.stringify({ email, password }), {
    ...jsonHeaders(),
    tags: { operation: 'authentication' },
  });
  if (!check(response, { 'login returns 200': (value) => value.status === 200 })) {
    fail(`Load-user login failed with HTTP ${response.status}`);
  }
  authenticated = true;
}

const expensePayload = {
  groupId,
  description: 'Performance workload shared meal',
  amountMinor: '10000',
  currency: 'INR',
  expenseDate: '2026-09-12',
  category: 'DINING',
  payers: [{ participantId: participantIds[0], paidAmountMinor: '10000' }],
  splitMethod: 'equal',
  beneficiaries: participantIds.map((participantId) => ({ participantId })),
};

export default function () {
  if (!authenticated) authenticate();

  const selector = Math.random();
  let response;
  if (selector < 0.25) {
    response = http.get(`${baseUrl}/api/v1/groups`, {
      tags: { operation: 'ordinary_financial' },
    });
  } else if (selector < 0.5) {
    response = http.get(`${baseUrl}/api/v1/groups/${groupId}`, {
      tags: { operation: 'ordinary_financial' },
    });
  } else if (selector < 0.75) {
    response = http.get(`${baseUrl}/api/v1/groups/${groupId}/expenses?limit=30`, {
      tags: { operation: 'ordinary_financial' },
    });
  } else if (selector < 0.95) {
    response = http.post(
      `${baseUrl}/api/v1/expenses/split-preview`,
      JSON.stringify(expensePayload),
      { ...jsonHeaders(), tags: { operation: 'ordinary_financial' } },
    );
  } else {
    const csrfValues = http.cookieJar().cookiesForURL(baseUrl).SPLITO_CSRF || [];
    response = http.post(
      `${baseUrl}/api/v1/expenses`,
      JSON.stringify({
        ...expensePayload,
        description: `Performance expense VU ${__VU} iteration ${__ITER}`,
      }),
      {
        ...jsonHeaders({
          'x-csrf-token': csrfValues[0] || '',
          'idempotency-key': `k6-${__VU}-${__ITER}-${Date.now()}`,
        }),
        tags: { operation: 'ordinary_financial' },
      },
    );
  }

  check(response, {
    'ordinary operation succeeds': (value) => value.status >= 200 && value.status < 300,
    'request id returned': (value) => Boolean(value.headers['X-Request-Id']),
  });
  sleep(0.15 + Math.random() * 0.35);
}

export function handleSummary(data) {
  return {
    stdout: JSON.stringify(data.metrics, null, 2),
    'performance/results/latest-summary.json': JSON.stringify(data, null, 2),
  };
}

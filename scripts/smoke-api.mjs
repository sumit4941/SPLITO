import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';

const apiBase = (process.env.SPLITO_API_ORIGIN ?? 'http://127.0.0.1:3000').replace(/\/$/u, '');
const demoPassword = process.env.SPLITO_DEMO_PASSWORD ?? 'SplitoDemo!2026';
const demoMobile = process.env.SPLITO_DEMO_MOBILE ?? '+12025550101';
const financialCookies = new Map();
const fictionalMobileAttempts = 4;
const smokeRunId = randomUUID();

function updateCookies(headers, cookieJar) {
  const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  for (const value of values) {
    const pair = value.split(';', 1)[0];
    const separator = pair.indexOf('=');
    if (separator < 1) continue;
    const name = pair.slice(0, separator);
    const cookieValue = pair.slice(separator + 1);
    if (cookieValue) cookieJar.set(name, cookieValue);
    else cookieJar.delete(name);
  }
}

async function request(
  path,
  { body, cookieJar = financialCookies, headers = {}, method = 'GET', withCsrf = false } = {},
) {
  const requestHeaders = new Headers({ accept: 'application/json', ...headers });
  if (body !== undefined) requestHeaders.set('content-type', 'application/json');
  if (cookieJar.size > 0) {
    requestHeaders.set(
      'cookie',
      [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join('; '),
    );
  }
  if (withCsrf) {
    const csrf = cookieJar.get('SPLITO_CSRF');
    assert.ok(csrf, 'The authenticated session did not set SPLITO_CSRF');
    requestHeaders.set('x-csrf-token', decodeURIComponent(csrf));
  }

  const response = await fetch(`${apiBase}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: requestHeaders,
    method,
  });
  updateCookies(response.headers, cookieJar);
  const contentType = response.headers.get('content-type') ?? '';
  const payload =
    response.status === 204
      ? undefined
      : contentType.includes('application/json')
        ? await response.json()
        : await response.text();
  return { headers: response.headers, payload, status: response.status };
}

function expectStatus(result, expected, label) {
  assert.equal(
    result.status,
    expected,
    `${label}: expected HTTP ${expected}, received ${result.status}: ${JSON.stringify(result.payload)}`,
  );
}

function expectedMaskedMobileNumber(mobileNumber) {
  return `+${'*'.repeat(Math.max(4, mobileNumber.length - 5))}${mobileNumber.slice(-4)}`;
}

function differentOtp(otp) {
  return `${(Number(otp[0]) + 1) % 10}${otp.slice(1)}`;
}

function nextFictionalUkMobile(usedNumbers) {
  // Ofcom reserves +44 7700 900000-900999 for fictional use, so this never targets a subscriber.
  let mobileNumber;
  do {
    mobileNumber = `+447700900${randomInt(0, 1_000).toString().padStart(3, '0')}`;
  } while (usedNumbers.has(mobileNumber));
  usedNumbers.add(mobileNumber);
  return mobileNumber;
}

async function requestDevelopmentOtp(mobileNumber, cookieJar, label) {
  const result = await request('/api/v1/auth/mobile/request-otp', {
    body: { mobileNumber, purpose: 'login' },
    cookieJar,
    method: 'POST',
  });
  if (result.status === 503) {
    assert.fail(
      `${label}: live OTP smoke is development-only because no production SMS adapter is configured`,
    );
  }
  expectStatus(result, 202, label);
  assert.equal(result.headers.get('cache-control'), 'no-store', `${label}: response is cacheable`);

  const challenge = result.payload?.data;
  assert.ok(challenge && typeof challenge === 'object', `${label}: response data is missing`);
  assert.deepEqual(
    Object.keys(challenge).sort(),
    [
      'challengeId',
      'developmentOtp',
      'expiresInSeconds',
      'maskedMobileNumber',
      'resendAfterSeconds',
    ].sort(),
    `${label}: response does not match the development challenge contract`,
  );
  assert.match(challenge.challengeId, /^[0-9a-f-]{36}$/u);
  assert.equal(challenge.maskedMobileNumber, expectedMaskedMobileNumber(mobileNumber));
  assert.equal(challenge.expiresInSeconds, 300);
  assert.equal(challenge.resendAfterSeconds, 60);
  assert.match(
    challenge.developmentOtp,
    /^[0-9]{6}$/u,
    `${label}: developmentOtp is required when NODE_ENV=development`,
  );
  assert.ok(
    !JSON.stringify(result.payload).includes(mobileNumber),
    `${label}: response exposed mobile`,
  );
  return challenge;
}

const checks = [];

const live = await request('/api/v1/health/live');
expectStatus(live, 200, 'liveness');
assert.match(live.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/u);
checks.push('liveness');

const ready = await request('/api/v1/health/ready');
expectStatus(ready, 200, 'service readiness');
checks.push('service readiness');

const anonymous = await request('/api/v1/me');
expectStatus(anonymous, 401, 'anonymous access denial');
checks.push('anonymous authorization boundary');

const usedFictionalMobiles = new Set();
let freshAccount;
for (let attempt = 1; attempt <= fictionalMobileAttempts; attempt += 1) {
  const mobileNumber = nextFictionalUkMobile(usedFictionalMobiles);
  const cookieJar = new Map();
  const challenge = await requestDevelopmentOtp(
    mobileNumber,
    cookieJar,
    `fictional mobile OTP request ${attempt}`,
  );
  const verificationBody = {
    challengeId: challenge.challengeId,
    deviceName: 'local-new-account-otp-smoke-test',
    locale: 'en-GB',
    mobileNumber,
    otp: challenge.developmentOtp,
    timezone: 'Europe/London',
  };

  const wrongVerification = await request('/api/v1/auth/mobile/verify-otp', {
    body: { ...verificationBody, otp: differentOtp(challenge.developmentOtp) },
    cookieJar,
    method: 'POST',
  });
  expectStatus(wrongVerification, 400, 'wrong mobile OTP denial');

  const verification = await request('/api/v1/auth/mobile/verify-otp', {
    body: verificationBody,
    cookieJar,
    method: 'POST',
  });
  expectStatus(verification, 200, 'fictional mobile OTP verification');
  assert.equal(verification.headers.get('cache-control'), 'no-store');
  assert.equal(verification.payload.data.user.mobileNumber, mobileNumber);
  assert.ok(cookieJar.get('SPLITO_SESSION'), 'OTP verification did not set a session cookie');
  assert.ok(cookieJar.get('SPLITO_CSRF'), 'OTP verification did not set a CSRF cookie');

  const currentAccount = await request('/api/v1/me', { cookieJar });
  expectStatus(currentAccount, 200, 'new mobile account current-user lookup');
  assert.equal(currentAccount.payload.data.mobileNumber, mobileNumber);

  const replayedOtp = await request('/api/v1/auth/mobile/verify-otp', {
    body: verificationBody,
    cookieJar: new Map(),
    method: 'POST',
  });
  expectStatus(replayedOtp, 400, 'mobile OTP replay denial');

  if (verification.payload.data.isNewAccount === true) {
    freshAccount = { cookieJar, mobileNumber };
    break;
  }

  const collisionLogout = await request('/api/v1/auth/logout', {
    cookieJar,
    method: 'POST',
    withCsrf: true,
  });
  expectStatus(collisionLogout, 204, 'fictional identity collision logout');
}
assert.ok(
  freshAccount,
  `Could not provision a fresh account after ${fictionalMobileAttempts} reserved fictional numbers`,
);
checks.push('development OTP denial, one-time use, and atomic first-login account creation');

const freshAccountLogout = await request('/api/v1/auth/logout', {
  cookieJar: freshAccount.cookieJar,
  method: 'POST',
  withCsrf: true,
});
expectStatus(freshAccountLogout, 204, 'fresh fictional account logout');

const otpCookies = new Map();
const otpChallenge = await requestDevelopmentOtp(
  demoMobile,
  otpCookies,
  'seeded Alice mobile OTP request',
);
const otpBody = {
  challengeId: otpChallenge.challengeId,
  deviceName: 'local-returning-account-otp-smoke-test',
  locale: 'en-IN',
  mobileNumber: demoMobile,
  otp: otpChallenge.developmentOtp,
  timezone: 'Asia/Kolkata',
};
const otpVerification = await request('/api/v1/auth/mobile/verify-otp', {
  body: otpBody,
  cookieJar: otpCookies,
  method: 'POST',
});
expectStatus(otpVerification, 200, 'seeded Alice mobile OTP verification');
assert.equal(otpVerification.headers.get('cache-control'), 'no-store');
assert.equal(otpVerification.payload.data.user.mobileNumber, demoMobile);
assert.equal(otpVerification.payload.data.isNewAccount, false);
assert.ok(otpCookies.get('SPLITO_SESSION'), 'OTP verification did not set a session cookie');

const login = await request('/api/v1/auth/login', {
  body: { deviceName: 'local-smoke-test', email: 'alice@splito.example', password: demoPassword },
  cookieJar: financialCookies,
  method: 'POST',
});
expectStatus(login, 200, 'login');
assert.ok(financialCookies.get('SPLITO_SESSION'), 'Login did not set the opaque session cookie');
assert.ok(financialCookies.get('SPLITO_CSRF'), 'Login did not set the CSRF cookie');
const supersededOtpSession = await request('/api/v1/me', { cookieJar: otpCookies });
expectStatus(supersededOtpSession, 401, 'single-active-login revocation');
checks.push('returning mobile identity and atomic single-active-session replacement');

const me = await request('/api/v1/me', { cookieJar: financialCookies });
expectStatus(me, 200, 'current user');
assert.equal(me.payload.data.email, 'alice@splito.example');
assert.equal(me.payload.data.mobileNumber, demoMobile);
checks.push('authenticated current-user lookup');

const groups = await request('/api/v1/groups');
expectStatus(groups, 200, 'group list');
assert.ok(
  Array.isArray(groups.payload.data) && groups.payload.data.length > 0,
  'Seed group missing',
);
const groupId = groups.payload.data[0].id;

const group = await request(`/api/v1/groups/${encodeURIComponent(groupId)}`);
expectStatus(group, 200, 'group detail');
assert.ok(group.payload.data.members.length >= 3, 'Smoke test requires three seeded members');
const participants = [...group.payload.data.members]
  .map((member) => member.id)
  .sort((left, right) => left.localeCompare(right));
checks.push('membership-filtered group list and detail');

const expenseBody = {
  amountMinor: '101',
  beneficiaries: participants.map((participantId) => ({ participantId })),
  category: 'testing',
  currency: group.payload.data.defaultCurrency,
  description: 'Local API smoke expense',
  expenseDate: '2026-09-12',
  groupId,
  notes: 'Repeatable integration verification; the idempotency key prevents duplicates.',
  payers: [{ paidAmountMinor: '101', participantId: participants[0] }],
  splitMethod: 'equal',
};

const preview = await request('/api/v1/expenses/split-preview', {
  body: expenseBody,
  method: 'POST',
});
expectStatus(preview, 200, 'split preview');
const allocated = preview.payload.data.allocations.reduce(
  (sum, item) => sum + BigInt(item.owedAmountMinor),
  0n,
);
assert.equal(allocated, 101n, 'Largest-remainder split did not preserve the total');
checks.push('deterministic largest-remainder split');

const missingCsrf = await request('/api/v1/expenses', {
  body: expenseBody,
  headers: { 'idempotency-key': 'splito-local-smoke-rejected-v1' },
  method: 'POST',
});
expectStatus(missingCsrf, 403, 'CSRF denial');
checks.push('CSRF denial on a financial mutation');

const mutationOptions = {
  body: expenseBody,
  headers: { 'idempotency-key': `splito-local-smoke-expense-${smokeRunId}` },
  method: 'POST',
  withCsrf: true,
};
const created = await request('/api/v1/expenses', mutationOptions);
expectStatus(created, 201, 'expense creation');
assert.ok(created.payload.data.id, 'Expense creation did not return an ID');

const replayed = await request('/api/v1/expenses', mutationOptions);
expectStatus(replayed, 201, 'expense idempotency replay');
assert.equal(replayed.payload.data.id, created.payload.data.id);
assert.equal(replayed.headers.get('idempotency-replayed'), 'true');
checks.push('atomic expense posting and stored idempotency replay');

const detail = await request(`/api/v1/expenses/${encodeURIComponent(created.payload.data.id)}`);
expectStatus(detail, 200, 'expense detail');
assert.equal(detail.payload.data.id, created.payload.data.id);
assert.equal(detail.payload.data.payers.length, 1);
assert.equal(detail.payload.data.allocations.length, participants.length);
checks.push('authorized expense reconstruction');

const expenses = await request(`/api/v1/groups/${encodeURIComponent(groupId)}/expenses?limit=5`);
expectStatus(expenses, 200, 'expense list');
assert.ok(expenses.payload.data.items.some((item) => item.id === created.payload.data.id));

const balances = await request(`/api/v1/groups/${encodeURIComponent(groupId)}/balances`);
expectStatus(balances, 200, 'group balances');
assert.ok(Array.isArray(balances.payload.data));
checks.push('cursor expense list and materialized balances');

const settlementPreview = await request('/api/v1/settlements/preview', {
  body: {
    amountMinor: '1',
    context: { id: groupId, type: 'group' },
    currency: group.payload.data.defaultCurrency,
    method: 'cash',
    recipientId: participants[0],
    senderId: participants[1],
    settlementDate: '2026-09-12',
  },
  method: 'POST',
});
expectStatus(settlementPreview, 200, 'settlement preview');
assert.match(settlementPreview.payload.data.previewVersion, /^[a-f0-9]{64}$/u);
checks.push('versioned settlement preview');

const logout = await request('/api/v1/auth/logout', { method: 'POST', withCsrf: true });
expectStatus(logout, 204, 'logout');
const afterLogout = await request('/api/v1/me');
expectStatus(afterLogout, 401, 'revoked session denial');
checks.push('server-side logout revocation');

console.log(
  JSON.stringify({ apiBase, checks, expenseId: created.payload.data.id, ok: true }, null, 2),
);

import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';

const apiBase = (process.env.SPLITO_API_ORIGIN ?? 'http://127.0.0.1:3000').replace(/\/$/u, '');
const demoPassword = process.env.SPLITO_DEMO_PASSWORD ?? 'SplitoDemo!2026';
const usedMobiles = new Set();

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
  { body, cookieJar = new Map(), headers = {}, method = 'GET', withCsrf = false } = {},
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
    assert.ok(csrf, 'Authenticated mutation is missing the SPLITO_CSRF cookie');
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

function expectError(result, status, code, label) {
  expectStatus(result, status, label);
  assert.equal(result.payload?.error?.code, code, `${label}: unexpected error response`);
}

async function login(email, deviceName) {
  const cookieJar = new Map();
  const result = await request('/api/v1/auth/login', {
    body: { deviceName, email, password: demoPassword },
    cookieJar,
    method: 'POST',
  });
  expectStatus(result, 200, `${email} login`);
  assert.ok(cookieJar.get('SPLITO_SESSION'));
  assert.ok(cookieJar.get('SPLITO_CSRF'));
  return { cookieJar, user: result.payload.data };
}

function nextFictionalUkMobile() {
  // Ofcom reserves +44 7700 900000-900999 for fictional use.
  let mobileNumber;
  do {
    mobileNumber = `+447700900${randomInt(0, 1_000).toString().padStart(3, '0')}`;
  } while (usedMobiles.has(mobileNumber));
  usedMobiles.add(mobileNumber);
  return mobileNumber;
}

async function registerInvitedMobile(mobileNumber) {
  const cookieJar = new Map();
  const challenge = await request('/api/v1/auth/mobile/request-otp', {
    body: { mobileNumber, purpose: 'login' },
    cookieJar,
    method: 'POST',
  });
  expectStatus(challenge, 202, 'invited mobile OTP request');
  assert.match(challenge.payload?.data?.developmentOtp ?? '', /^[0-9]{6}$/u);

  const verification = await request('/api/v1/auth/mobile/verify-otp', {
    body: {
      challengeId: challenge.payload.data.challengeId,
      deviceName: 'group-invitation-smoke',
      locale: 'en-GB',
      mobileNumber,
      otp: challenge.payload.data.developmentOtp,
      timezone: 'Europe/London',
    },
    cookieJar,
    method: 'POST',
  });
  expectStatus(verification, 200, 'invited mobile first login');
  assert.equal(verification.payload.data.isNewAccount, true);
  return { cookieJar, user: verification.payload.data.user };
}

const checks = [];
const owner = await login('alice@splito.example', 'group-invitation-owner-smoke');
const registeredMember = await login('bob@splito.example', 'group-invitation-member-smoke');

const groupCreation = await request('/api/v1/groups', {
  body: {
    defaultCurrency: 'INR',
    description: 'Repeatable registered and invited member authorization verification',
    name: `Invitation smoke ${randomUUID().slice(0, 8)}`,
    simplificationEnabled: false,
    type: 'project',
  },
  cookieJar: owner.cookieJar,
  method: 'POST',
  withCsrf: true,
});
expectStatus(groupCreation, 201, 'group creation');
const groupId = groupCreation.payload.data.id;

const directAdd = await request(`/api/v1/groups/${encodeURIComponent(groupId)}/members`, {
  body: { mobileNumber: '+12025550102' },
  cookieJar: owner.cookieJar,
  method: 'POST',
  withCsrf: true,
});
expectStatus(directAdd, 201, 'registered account direct add');
assert.equal(directAdd.payload.data.outcome, 'member_added');
assert.equal(directAdd.payload.data.member.id, registeredMember.user.participantId);
assert.equal(directAdd.payload.data.member.kind, 'USER');
assert.ok(!('developmentJoinUrl' in directAdd.payload.data));
checks.push('registered account is activated directly without an invitation');

let invite;
let invitedMobile;
let collisionCount = 0;
for (let attempt = 1; attempt <= 5; attempt += 1) {
  invitedMobile = nextFictionalUkMobile();
  invite = await request(`/api/v1/groups/${encodeURIComponent(groupId)}/members`, {
    body: { mobileNumber: invitedMobile },
    cookieJar: owner.cookieJar,
    method: 'POST',
    withCsrf: true,
  });
  if (invite.status === 202) break;
  expectStatus(invite, 201, `fictional mobile collision ${attempt}`);
  collisionCount += 1;
}
expectStatus(invite, 202, 'unregistered account invitation');
assert.equal(invite.payload.data.outcome, 'invitation_sent');
assert.equal(invite.payload.data.invitation.status, 'pending');
assert.ok(!JSON.stringify(invite.payload.data.invitation).includes(invitedMobile));
const joinUrl = new URL(invite.payload.data.developmentJoinUrl);
assert.equal(joinUrl.pathname, '/join');
assert.equal(joinUrl.search, '', 'Invitation token must not appear in a query string');
const token = new URLSearchParams(joinUrl.hash.slice(1)).get('invite');
assert.match(token ?? '', /^[A-Za-z0-9_-]{43}$/u);
checks.push('unregistered mobile receives a masked, fragment-token development SMS link');

const ownerBeforeAcceptance = await request(`/api/v1/groups/${encodeURIComponent(groupId)}`, {
  cookieJar: owner.cookieJar,
});
expectStatus(ownerBeforeAcceptance, 200, 'owner group detail before invitation acceptance');
assert.equal(ownerBeforeAcceptance.payload.data.members.length, 2 + collisionCount);
assert.equal(ownerBeforeAcceptance.payload.data.pendingInvitations.length, 1);
assert.equal(
  ownerBeforeAcceptance.payload.data.pendingInvitations[0].id,
  invite.payload.data.invitation.id,
);

const memberBeforeAcceptance = await request(`/api/v1/groups/${encodeURIComponent(groupId)}`, {
  cookieJar: registeredMember.cookieJar,
});
expectStatus(memberBeforeAcceptance, 200, 'ordinary member group detail');
assert.deepEqual(memberBeforeAcceptance.payload.data.pendingInvitations, []);

const wrongAccountPreview = await request('/api/v1/group-invitations/preview', {
  body: { token },
  cookieJar: registeredMember.cookieJar,
  method: 'POST',
});
expectError(wrongAccountPreview, 404, 'GROUP_INVITATION_NOT_FOUND', 'wrong-account preview denial');
const wrongAccountAccept = await request('/api/v1/group-invitations/accept', {
  body: { token },
  cookieJar: registeredMember.cookieJar,
  method: 'POST',
  withCsrf: true,
});
expectError(wrongAccountAccept, 404, 'GROUP_INVITATION_NOT_FOUND', 'wrong-account accept denial');
checks.push('invitation is phone-bound and hidden from other members');

const invited = await registerInvitedMobile(invitedMobile);
const membershipBeforeAcceptance = await request(`/api/v1/groups/${encodeURIComponent(groupId)}`, {
  cookieJar: invited.cookieJar,
});
expectError(
  membershipBeforeAcceptance,
  404,
  'GROUP_NOT_FOUND',
  'registration alone is not membership',
);

const preview = await request('/api/v1/group-invitations/preview', {
  body: { token },
  cookieJar: invited.cookieJar,
  method: 'POST',
});
expectStatus(preview, 200, 'phone-bound invitation preview');
assert.equal(preview.payload.data.groupId, groupId);
assert.equal(preview.payload.data.invitationId, invite.payload.data.invitation.id);

const accepted = await request('/api/v1/group-invitations/accept', {
  body: { token },
  cookieJar: invited.cookieJar,
  method: 'POST',
  withCsrf: true,
});
expectStatus(accepted, 200, 'invitation acceptance');
assert.equal(accepted.payload.data.outcome, 'joined');
assert.equal(accepted.payload.data.member.id, invited.user.participantId);
assert.equal(accepted.payload.data.member.kind, 'USER');

const replayedAcceptance = await request('/api/v1/group-invitations/accept', {
  body: { token },
  cookieJar: invited.cookieJar,
  method: 'POST',
  withCsrf: true,
});
expectStatus(replayedAcceptance, 200, 'same-account invitation acceptance retry');
assert.equal(replayedAcceptance.payload.data.outcome, 'joined');
assert.equal(replayedAcceptance.payload.data.member.id, invited.user.participantId);

const ownerAfterAcceptance = await request(`/api/v1/groups/${encodeURIComponent(groupId)}`, {
  cookieJar: owner.cookieJar,
});
expectStatus(ownerAfterAcceptance, 200, 'owner group detail after acceptance');
assert.equal(ownerAfterAcceptance.payload.data.members.length, 3 + collisionCount);
assert.deepEqual(ownerAfterAcceptance.payload.data.pendingInvitations, []);
checks.push('first login creates the account; explicit acceptance activates one membership');

const participantIds = [
  owner.user.participantId,
  registeredMember.user.participantId,
  invited.user.participantId,
];
const originalExpense = {
  amountMinor: '303',
  beneficiaries: participantIds.map((participantId) => ({ participantId })),
  category: 'testing',
  currency: 'INR',
  description: 'Creator authorization smoke expense',
  expenseDate: '2026-09-13',
  groupId,
  notes: 'All active members may read this; only its creator may edit it.',
  payers: [{ paidAmountMinor: '303', participantId: registeredMember.user.participantId }],
  splitMethod: 'equal',
};
const created = await request('/api/v1/expenses', {
  body: originalExpense,
  cookieJar: registeredMember.cookieJar,
  headers: { 'idempotency-key': `expense-create-${randomUUID()}` },
  method: 'POST',
  withCsrf: true,
});
expectStatus(created, 201, 'member expense creation');
const expenseId = created.payload.data.id;
assert.equal(created.payload.data.createdBy.id, registeredMember.user.participantId);
assert.equal(created.payload.data.canEdit, true);

for (const [label, account, canEdit] of [
  ['owner', owner, false],
  ['creator', registeredMember, true],
  ['invited member', invited, false],
]) {
  const detail = await request(`/api/v1/expenses/${encodeURIComponent(expenseId)}`, {
    cookieJar: account.cookieJar,
  });
  expectStatus(detail, 200, `${label} expense detail`);
  assert.equal(detail.payload.data.createdBy.id, registeredMember.user.participantId);
  assert.equal(detail.payload.data.canEdit, canEdit, `${label} canEdit`);
  assert.equal(detail.headers.get('etag'), `"${detail.payload.data.version}"`);

  const list = await request(`/api/v1/groups/${encodeURIComponent(groupId)}/expenses?limit=10`, {
    cookieJar: account.cookieJar,
  });
  expectStatus(list, 200, `${label} expense list`);
  const listed = list.payload.data.items.find((item) => item.id === expenseId);
  assert.ok(listed, `${label} cannot see the group expense`);
  assert.equal(listed.createdBy.id, registeredMember.user.participantId);
  assert.equal(listed.canEdit, canEdit, `${label} list canEdit`);
}
checks.push('all active members can list and inspect every group expense');

const editedExpense = {
  ...originalExpense,
  amountMinor: '606',
  currency: 'USD',
  description: 'Creator-updated cross-currency expense',
  notes: 'The old INR journal is reversed and a new USD journal is appended.',
  payers: [{ paidAmountMinor: '606', participantId: registeredMember.user.participantId }],
};

for (const [label, account] of [
  ['owner non-creator', owner],
  ['ordinary non-creator', invited],
]) {
  const denied = await request(`/api/v1/expenses/${encodeURIComponent(expenseId)}`, {
    body: editedExpense,
    cookieJar: account.cookieJar,
    headers: {
      'idempotency-key': `expense-denied-${randomUUID()}`,
      'if-match': created.payload.data.version,
    },
    method: 'PUT',
    withCsrf: true,
  });
  expectError(denied, 404, 'EXPENSE_NOT_FOUND', `${label} expense edit denial`);
}

const missingVersion = await request(`/api/v1/expenses/${encodeURIComponent(expenseId)}`, {
  body: editedExpense,
  cookieJar: registeredMember.cookieJar,
  headers: { 'idempotency-key': `expense-no-version-${randomUUID()}` },
  method: 'PUT',
  withCsrf: true,
});
expectError(missingVersion, 428, 'RESOURCE_VERSION_REQUIRED', 'missing If-Match denial');

const updateKey = `expense-update-${randomUUID()}`;
const updateOptions = {
  body: editedExpense,
  cookieJar: registeredMember.cookieJar,
  headers: { 'idempotency-key': updateKey, 'if-match': `"${created.payload.data.version}"` },
  method: 'PUT',
  withCsrf: true,
};
const updated = await request(`/api/v1/expenses/${encodeURIComponent(expenseId)}`, updateOptions);
expectStatus(updated, 200, 'creator expense update');
assert.equal(updated.payload.data.id, expenseId);
assert.equal(updated.payload.data.amount.currency, 'USD');
assert.equal(updated.payload.data.amount.amountMinor, '606');
assert.equal(updated.payload.data.revisionNumber, created.payload.data.revisionNumber + 1);
assert.equal(BigInt(updated.payload.data.version), BigInt(created.payload.data.version) + 1n);
assert.equal(updated.payload.data.canEdit, true);
assert.equal(updated.headers.get('etag'), `"${updated.payload.data.version}"`);

const replayedUpdate = await request(
  `/api/v1/expenses/${encodeURIComponent(expenseId)}`,
  updateOptions,
);
expectStatus(replayedUpdate, 200, 'creator update idempotency replay');
assert.deepEqual(replayedUpdate.payload.data, updated.payload.data);
assert.equal(replayedUpdate.headers.get('idempotency-replayed'), 'true');

const staleUpdate = await request(`/api/v1/expenses/${encodeURIComponent(expenseId)}`, {
  body: { ...editedExpense, description: 'Stale overwrite must not win' },
  cookieJar: registeredMember.cookieJar,
  headers: {
    'idempotency-key': `expense-stale-${randomUUID()}`,
    'if-match': created.payload.data.version,
  },
  method: 'PUT',
  withCsrf: true,
});
expectError(staleUpdate, 412, 'RESOURCE_VERSION_MISMATCH', 'stale creator edit denial');

for (const [label, account, canEdit] of [
  ['owner', owner, false],
  ['creator', registeredMember, true],
  ['invited member', invited, false],
]) {
  const detail = await request(`/api/v1/expenses/${encodeURIComponent(expenseId)}`, {
    cookieJar: account.cookieJar,
  });
  expectStatus(detail, 200, `${label} updated expense detail`);
  assert.equal(detail.payload.data.description, editedExpense.description);
  assert.equal(detail.payload.data.amount.currency, 'USD');
  assert.equal(detail.payload.data.canEdit, canEdit);
}
checks.push(
  'only the creator can edit; update is versioned, idempotent, and visible to all members',
);

console.log(JSON.stringify({ apiBase, checks, expenseId, groupId, ok: true }, null, 2));

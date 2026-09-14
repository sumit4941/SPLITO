import { Decimal128 } from 'mongodb';

export const COLLECTIONS = Object.freeze({
  currencies: 'currencies',
  users: 'users',
  participants: 'participants',
  userPreferences: 'userPreferences',
  authTokens: 'authTokens',
  sessions: 'sessions',
  mobileOtpChallenges: 'mobileOtpChallenges',
  mobileOtpThrottles: 'mobileOtpThrottles',
  contexts: 'contexts',
  groups: 'groups',
  contextMembers: 'contextMembers',
  invitations: 'invitations',
  expenses: 'expenses',
  expenseRevisions: 'expenseRevisions',
  ledgerBatches: 'ledgerBatches',
  balanceProjections: 'balanceProjections',
  bilateralProjections: 'bilateralProjections',
  settlements: 'settlements',
  settlementRevisions: 'settlementRevisions',
  idempotencyKeys: 'idempotencyKeys',
  idempotencyReceipts: 'idempotencyReceipts',
  outbox: 'outbox',
  auditEvents: 'auditEvents',
  mediaObjects: 'mediaObjects',
});

export const SCHEMA_VERSION = 1;
export const SCHEMA_MIGRATIONS_COLLECTION = 'schemaMigrations';
export const REFERENCE_CURRENCIES = Object.freeze([
  {
    _id: 'INR',
    code: 'INR',
    displayName: 'Indian Rupee',
    symbol: '₹',
    minorUnits: 2,
    active: true,
  },
  { _id: 'USD', code: 'USD', displayName: 'US Dollar', symbol: '$', minorUnits: 2, active: true },
  { _id: 'EUR', code: 'EUR', displayName: 'Euro', symbol: '€', minorUnits: 2, active: true },
  {
    _id: 'GBP',
    code: 'GBP',
    displayName: 'Pound Sterling',
    symbol: '£',
    minorUnits: 2,
    active: true,
  },
  {
    _id: 'JPY',
    code: 'JPY',
    displayName: 'Japanese Yen',
    symbol: '¥',
    minorUnits: 0,
    active: true,
  },
  {
    _id: 'KWD',
    code: 'KWD',
    displayName: 'Kuwaiti Dinar',
    symbol: 'د.ك',
    minorUnits: 3,
    active: true,
  },
]);

const stringField = { bsonType: 'string' };
const nonEmptyStringField = { bsonType: 'string', minLength: 1 };
const currencyCodeField = { bsonType: 'string', pattern: '^[A-Z]{3}$' };
const calendarDateField = { bsonType: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const dateField = { bsonType: 'date' };
const booleanField = { bsonType: 'bool' };
const nonNegativeIntegerField = { bsonType: ['int', 'long'], minimum: 0 };
const positiveIntegerField = { bsonType: ['int', 'long'], minimum: 1 };
const binaryField = { bsonType: 'binData' };
const maxMinorDecimal = Decimal128.fromString('9999999999999999999');
const minMinorDecimal = Decimal128.fromString('-9999999999999999999');
const zeroDecimal = Decimal128.fromString('0');
const oneDecimal = Decimal128.fromString('1');
const signedMinorField = {
  bsonType: 'decimal',
  minimum: minMinorDecimal,
  maximum: maxMinorDecimal,
};
const unsignedMinorField = {
  bsonType: 'decimal',
  minimum: zeroDecimal,
  maximum: maxMinorDecimal,
};
const positiveMinorField = {
  bsonType: 'decimal',
  minimum: oneDecimal,
  maximum: maxMinorDecimal,
};

function documentValidator(required, properties = {}, schemaRules = {}) {
  return {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', ...required],
      properties: { _id: stringField, ...properties },
      ...schemaRules,
    },
  };
}

// Validators deliberately leave additional fields open so forward-compatible
// deployments can add optional metadata. They do enforce the fields used for
// identity, transaction fences, financial arithmetic, and durable processing.
export const COLLECTION_VALIDATORS = Object.freeze({
  [COLLECTIONS.currencies]: documentValidator(
    ['code', 'displayName', 'symbol', 'minorUnits', 'active'],
    {
      code: stringField,
      displayName: stringField,
      symbol: stringField,
      minorUnits: { bsonType: ['int', 'long'], minimum: 0, maximum: 3 },
      active: booleanField,
    },
  ),
  [COLLECTIONS.users]: documentValidator(
    [
      'displayName',
      'localeCode',
      'timezoneName',
      'defaultCurrencyCode',
      'theme',
      'reducedMotion',
      'status',
      'authFence',
      'createdAt',
      'updatedAt',
    ],
    {
      emailNormalized: stringField,
      mobileE164: stringField,
      passwordHash: stringField,
      displayName: stringField,
      localeCode: stringField,
      timezoneName: stringField,
      defaultCurrencyCode: stringField,
      theme: { bsonType: 'string', enum: ['LIGHT', 'DARK', 'SYSTEM'] },
      reducedMotion: booleanField,
      status: {
        bsonType: 'string',
        enum: ['PENDING', 'ACTIVE', 'LOCKED', 'DELETION_PENDING', 'ANONYMIZED'],
      },
      authFence: positiveIntegerField,
      createdAt: dateField,
      updatedAt: dateField,
    },
  ),
  [COLLECTIONS.participants]: documentValidator(
    ['kind', 'displayName', 'status', 'createdAt', 'updatedAt'],
    {
      userId: stringField,
      kind: { bsonType: 'string', enum: ['USER', 'GUEST'] },
      displayName: stringField,
      status: { bsonType: 'string', enum: ['ACTIVE', 'MERGED', 'DELETED'] },
      createdAt: dateField,
      updatedAt: dateField,
    },
  ),
  [COLLECTIONS.userPreferences]: documentValidator(['userId', 'createdAt', 'updatedAt'], {
    userId: stringField,
    createdAt: dateField,
    updatedAt: dateField,
  }),
  [COLLECTIONS.authTokens]: documentValidator(
    ['userId', 'tokenType', 'tokenHash', 'expiresAt', 'createdAt'],
    {
      userId: stringField,
      tokenType: { bsonType: 'string', enum: ['EMAIL_VERIFY', 'PASSWORD_RESET'] },
      tokenHash: binaryField,
      expiresAt: dateField,
      consumedAt: dateField,
      createdAt: dateField,
    },
  ),
  [COLLECTIONS.sessions]: documentValidator(
    [
      'sessionId',
      'userId',
      'sessionTokenHash',
      'csrfSecretHash',
      'userAgentSummary',
      'ipAddressHash',
      'expiresAt',
      'lastSeenAt',
      'active',
      'createdAt',
      'updatedAt',
    ],
    {
      sessionId: stringField,
      userId: stringField,
      sessionTokenHash: binaryField,
      csrfSecretHash: binaryField,
      userAgentSummary: stringField,
      ipAddressHash: binaryField,
      expiresAt: dateField,
      lastSeenAt: dateField,
      active: booleanField,
      revokedAt: dateField,
      createdAt: dateField,
      updatedAt: dateField,
    },
  ),
  [COLLECTIONS.mobileOtpChallenges]: documentValidator(
    [
      'challengeId',
      'mobileE164',
      'purpose',
      'otpHash',
      'requestIpHash',
      'status',
      'attemptCount',
      'maxAttempts',
      'expiresAt',
      'purgeAt',
      'createdAt',
      'updatedAt',
    ],
    {
      challengeId: stringField,
      mobileE164: stringField,
      purpose: { bsonType: 'string', enum: ['LOGIN'] },
      otpHash: binaryField,
      requestIpHash: binaryField,
      status: {
        bsonType: 'string',
        enum: ['PENDING', 'VERIFIED', 'EXPIRED', 'LOCKED', 'SUPERSEDED'],
      },
      attemptCount: nonNegativeIntegerField,
      maxAttempts: positiveIntegerField,
      expiresAt: dateField,
      purgeAt: dateField,
      createdAt: dateField,
      updatedAt: dateField,
    },
  ),
  [COLLECTIONS.mobileOtpThrottles]: documentValidator(
    [
      'scope',
      'throttleKey',
      'requestCount',
      'windowStartedAt',
      'purgeAt',
      'createdAt',
      'updatedAt',
    ],
    {
      scope: { bsonType: 'string', enum: ['PHONE', 'IP'] },
      throttleKey: binaryField,
      requestCount: nonNegativeIntegerField,
      windowStartedAt: dateField,
      lastIssuedAt: dateField,
      purgeAt: dateField,
      createdAt: dateField,
      updatedAt: dateField,
    },
  ),
  [COLLECTIONS.contexts]: documentValidator(
    [
      'type',
      'defaultCurrencyCode',
      'simplificationEnabled',
      'status',
      'mutationVersion',
      'createdByParticipantId',
      'createdAt',
      'updatedAt',
    ],
    {
      type: { bsonType: 'string', enum: ['GROUP', 'DIRECT', 'PERSONAL'] },
      defaultCurrencyCode: stringField,
      simplificationEnabled: booleanField,
      status: { bsonType: 'string', enum: ['ACTIVE', 'ARCHIVED'] },
      mutationVersion: positiveIntegerField,
      createdByParticipantId: stringField,
      createdAt: dateField,
      updatedAt: dateField,
    },
  ),
  [COLLECTIONS.groups]: documentValidator(
    ['contextId', 'name', 'type', 'status', 'createdAt', 'updatedAt'],
    {
      contextId: stringField,
      name: stringField,
      type: stringField,
      status: { bsonType: 'string', enum: ['ACTIVE', 'ARCHIVED'] },
      createdAt: dateField,
      updatedAt: dateField,
    },
  ),
  [COLLECTIONS.contextMembers]: documentValidator(
    [
      'contextId',
      'participantId',
      'role',
      'status',
      'allocationOrder',
      'addedByParticipantId',
      'joinedAt',
      'createdAt',
      'updatedAt',
    ],
    {
      contextId: stringField,
      participantId: stringField,
      role: { bsonType: 'string', enum: ['OWNER', 'ADMIN', 'MEMBER'] },
      status: { bsonType: 'string', enum: ['ACTIVE', 'FORMER'] },
      allocationOrder: nonNegativeIntegerField,
      addedByParticipantId: stringField,
      joinedAt: dateField,
      createdAt: dateField,
      updatedAt: dateField,
    },
  ),
  [COLLECTIONS.invitations]: documentValidator(
    [
      'invitationType',
      'contextId',
      'inviterParticipantId',
      'inviteeMobileE164',
      'tokenHash',
      'status',
      'expiresAt',
      'resendCount',
      'createdAt',
      'updatedAt',
    ],
    {
      invitationType: { bsonType: 'string', enum: ['GROUP'] },
      contextId: stringField,
      inviterParticipantId: stringField,
      inviteeMobileE164: stringField,
      tokenHash: binaryField,
      status: {
        bsonType: 'string',
        enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'REVOKED', 'EXPIRED'],
      },
      expiresAt: dateField,
      resendCount: nonNegativeIntegerField,
      createdAt: dateField,
      updatedAt: dateField,
    },
  ),
  [COLLECTIONS.expenses]: documentValidator(
    [
      'contextId',
      'description',
      'currencyCode',
      'expenseDate',
      'businessTimezone',
      'categoryCode',
      'status',
      'createdByParticipantId',
      'currentRevisionId',
      'version',
      'createdAt',
      'updatedAt',
    ],
    {
      contextId: nonEmptyStringField,
      description: { bsonType: 'string', minLength: 1, maxLength: 300 },
      currencyCode: currencyCodeField,
      expenseDate: calendarDateField,
      businessTimezone: nonEmptyStringField,
      categoryCode: { bsonType: 'string', minLength: 1, maxLength: 50 },
      status: { bsonType: 'string', enum: ['DRAFT', 'POSTED', 'VOIDED'] },
      createdByParticipantId: nonEmptyStringField,
      currentRevisionId: nonEmptyStringField,
      version: { bsonType: 'string', pattern: '^[1-9][0-9]*$' },
      createdAt: dateField,
      updatedAt: dateField,
    },
  ),
  [COLLECTIONS.expenseRevisions]: documentValidator(
    [
      'expenseId',
      'revisionNumber',
      'totalMinor',
      'splitMethod',
      'algorithmVersion',
      'originalInputs',
      'createdByParticipantId',
      'payers',
      'shares',
      'obligations',
      'createdAt',
    ],
    {
      expenseId: nonEmptyStringField,
      revisionNumber: positiveIntegerField,
      totalMinor: positiveMinorField,
      splitMethod: {
        bsonType: 'string',
        enum: ['EQUAL', 'EXACT', 'PERCENTAGE', 'SHARES', 'ADJUSTMENTS'],
      },
      algorithmVersion: nonEmptyStringField,
      originalInputs: { bsonType: 'object' },
      notes: { bsonType: 'string', maxLength: 4_000 },
      previousRevisionId: nonEmptyStringField,
      createdByParticipantId: nonEmptyStringField,
      changeReason: nonEmptyStringField,
      payers: {
        bsonType: 'array',
        minItems: 1,
        maxItems: 100,
        items: {
          bsonType: 'object',
          required: ['id', 'participantId', 'paidMinor', 'allocationOrder'],
          properties: {
            id: nonEmptyStringField,
            participantId: nonEmptyStringField,
            paidMinor: positiveMinorField,
            allocationOrder: nonNegativeIntegerField,
          },
        },
      },
      shares: {
        bsonType: 'array',
        minItems: 1,
        maxItems: 100,
        items: {
          bsonType: 'object',
          required: ['id', 'participantId', 'owedMinor', 'allocationOrder'],
          properties: {
            id: nonEmptyStringField,
            participantId: nonEmptyStringField,
            owedMinor: unsignedMinorField,
            allocationOrder: nonNegativeIntegerField,
            inputValue: stringField,
          },
        },
      },
      obligations: {
        bsonType: 'array',
        maxItems: 100,
        items: {
          bsonType: 'object',
          required: [
            'id',
            'debtorParticipantId',
            'creditorParticipantId',
            'amountMinor',
            'matchOrder',
            'algorithmVersion',
          ],
          properties: {
            id: nonEmptyStringField,
            debtorParticipantId: nonEmptyStringField,
            creditorParticipantId: nonEmptyStringField,
            amountMinor: positiveMinorField,
            matchOrder: nonNegativeIntegerField,
            algorithmVersion: nonEmptyStringField,
          },
        },
      },
      createdAt: dateField,
    },
  ),
  [COLLECTIONS.ledgerBatches]: documentValidator(
    [
      'contextId',
      'currencyCode',
      'batchType',
      'sourceType',
      'sourceId',
      'sourceRevisionId',
      'idempotencyId',
      'actorParticipantId',
      'postings',
      'postedAt',
    ],
    {
      contextId: nonEmptyStringField,
      currencyCode: currencyCodeField,
      batchType: { bsonType: 'string', enum: ['EXPENSE', 'REVERSAL', 'SETTLEMENT'] },
      sourceType: { bsonType: 'string', enum: ['EXPENSE', 'SETTLEMENT'] },
      sourceId: nonEmptyStringField,
      sourceRevisionId: nonEmptyStringField,
      reversesBatchId: nonEmptyStringField,
      idempotencyId: nonEmptyStringField,
      actorParticipantId: nonEmptyStringField,
      postings: {
        bsonType: 'array',
        minItems: 2,
        maxItems: 100,
        items: {
          bsonType: 'object',
          required: ['id', 'participantId', 'amountMinor', 'postingOrder'],
          properties: {
            id: nonEmptyStringField,
            participantId: nonEmptyStringField,
            amountMinor: signedMinorField,
            postingOrder: nonNegativeIntegerField,
          },
        },
      },
      postedAt: dateField,
    },
  ),
  [COLLECTIONS.balanceProjections]: documentValidator(
    ['contextId', 'participantId', 'currencyCode', 'netMinor', 'version', 'createdAt', 'updatedAt'],
    {
      contextId: nonEmptyStringField,
      participantId: nonEmptyStringField,
      currencyCode: currencyCodeField,
      netMinor: signedMinorField,
      version: positiveIntegerField,
      createdAt: dateField,
      updatedAt: dateField,
    },
  ),
  [COLLECTIONS.bilateralProjections]: documentValidator(
    [
      'contextId',
      'participantLowId',
      'participantHighId',
      'currencyCode',
      'lowOwesHighMinor',
      'version',
      'updatedAt',
    ],
    {
      contextId: nonEmptyStringField,
      participantLowId: nonEmptyStringField,
      participantHighId: nonEmptyStringField,
      currencyCode: currencyCodeField,
      lowOwesHighMinor: signedMinorField,
      version: positiveIntegerField,
      updatedAt: dateField,
    },
  ),
  [COLLECTIONS.settlements]: documentValidator(
    [
      'contextId',
      'senderParticipantId',
      'recipientParticipantId',
      'currencyCode',
      'amountMinor',
      'settlementDate',
      'businessTimezone',
      'method',
      'status',
      'assertion',
      'currentRevisionId',
      'version',
      'createdByParticipantId',
      'createdAt',
      'updatedAt',
    ],
    {
      contextId: nonEmptyStringField,
      senderParticipantId: nonEmptyStringField,
      recipientParticipantId: nonEmptyStringField,
      currencyCode: currencyCodeField,
      amountMinor: positiveMinorField,
      settlementDate: calendarDateField,
      businessTimezone: nonEmptyStringField,
      method: { bsonType: 'string', enum: ['CASH', 'BANK', 'UPI', 'CARD', 'OTHER'] },
      status: { bsonType: 'string', enum: ['POSTED'] },
      assertion: { bsonType: 'bool', enum: [true] },
      currentRevisionId: nonEmptyStringField,
      version: positiveIntegerField,
      createdByParticipantId: nonEmptyStringField,
      createdAt: dateField,
      updatedAt: dateField,
    },
  ),
  [COLLECTIONS.settlementRevisions]: documentValidator(
    [
      'settlementId',
      'revisionNumber',
      'amountMinor',
      'method',
      'changeType',
      'createdByParticipantId',
      'createdAt',
    ],
    {
      settlementId: nonEmptyStringField,
      revisionNumber: positiveIntegerField,
      amountMinor: positiveMinorField,
      method: { bsonType: 'string', enum: ['CASH', 'BANK', 'UPI', 'CARD', 'OTHER'] },
      note: { bsonType: 'string', maxLength: 2_000 },
      changeType: { bsonType: 'string', enum: ['CREATE'] },
      createdByParticipantId: nonEmptyStringField,
      createdAt: dateField,
    },
  ),
  [COLLECTIONS.idempotencyKeys]: documentValidator(
    [
      'id',
      'actorParticipantId',
      'operationKey',
      'keyHash',
      'requestHash',
      'status',
      'createdAt',
      'expiresAt',
    ],
    {
      id: nonEmptyStringField,
      actorParticipantId: nonEmptyStringField,
      operationKey: nonEmptyStringField,
      keyHash: { bsonType: 'string', pattern: '^[0-9a-f]{64}$' },
      requestHash: { bsonType: 'string', pattern: '^[0-9a-f]{64}$' },
      status: { bsonType: 'string', enum: ['IN_PROGRESS', 'COMPLETED'] },
      httpStatus: { bsonType: ['int', 'long'], minimum: 100, maximum: 599 },
      resourceId: nonEmptyStringField,
      createdAt: dateField,
      completedAt: dateField,
      expiresAt: dateField,
    },
    {
      oneOf: [
        {
          properties: { status: { enum: ['IN_PROGRESS'] } },
          not: {
            anyOf: [
              { required: ['httpStatus'] },
              { required: ['responseBody'] },
              { required: ['resourceId'] },
              { required: ['completedAt'] },
            ],
          },
        },
        {
          required: ['httpStatus', 'responseBody', 'completedAt'],
          properties: { status: { enum: ['COMPLETED'] } },
        },
      ],
    },
  ),
  [COLLECTIONS.idempotencyReceipts]: documentValidator(
    [
      'scopeId',
      'actorParticipantId',
      'operationKey',
      'keyHash',
      'requestHash',
      'httpStatus',
      'createdAt',
      'completedAt',
    ],
    {
      scopeId: { bsonType: 'string', pattern: '^[0-9a-f]{64}$' },
      actorParticipantId: nonEmptyStringField,
      operationKey: nonEmptyStringField,
      keyHash: { bsonType: 'string', pattern: '^[0-9a-f]{64}$' },
      requestHash: { bsonType: 'string', pattern: '^[0-9a-f]{64}$' },
      httpStatus: { bsonType: ['int', 'long'], minimum: 100, maximum: 599 },
      resourceId: nonEmptyStringField,
      createdAt: dateField,
      completedAt: dateField,
    },
  ),
  [COLLECTIONS.outbox]: documentValidator(
    [
      'eventType',
      'aggregateType',
      'aggregateId',
      'payload',
      'status',
      'attempts',
      'availableAt',
      'createdAt',
    ],
    {
      eventType: nonEmptyStringField,
      aggregateType: nonEmptyStringField,
      aggregateId: nonEmptyStringField,
      status: {
        bsonType: 'string',
        enum: ['PENDING', 'LEASED', 'RETRY', 'PROCESSED', 'DEAD'],
      },
      attempts: nonNegativeIntegerField,
      availableAt: dateField,
      leasedUntil: dateField,
      leaseOwner: nonEmptyStringField,
      lastError: { bsonType: 'string', maxLength: 2_000 },
      processedAt: dateField,
      createdAt: dateField,
    },
    {
      oneOf: [
        {
          properties: { status: { enum: ['PENDING'] } },
          not: {
            anyOf: [
              { required: ['leaseOwner'] },
              { required: ['leasedUntil'] },
              { required: ['processedAt'] },
            ],
          },
        },
        {
          required: ['leaseOwner', 'leasedUntil'],
          properties: { status: { enum: ['LEASED'] } },
          not: { required: ['processedAt'] },
        },
        {
          properties: { status: { enum: ['RETRY'] } },
          not: {
            anyOf: [
              { required: ['leaseOwner'] },
              { required: ['leasedUntil'] },
              { required: ['processedAt'] },
            ],
          },
        },
        {
          required: ['processedAt'],
          properties: { status: { enum: ['PROCESSED'] } },
          not: { anyOf: [{ required: ['leaseOwner'] }, { required: ['leasedUntil'] }] },
        },
        {
          properties: { status: { enum: ['DEAD'] } },
          not: {
            anyOf: [
              { required: ['leaseOwner'] },
              { required: ['leasedUntil'] },
              { required: ['processedAt'] },
            ],
          },
        },
      ],
    },
  ),
  [COLLECTIONS.auditEvents]: documentValidator(
    ['actionKey', 'resourceType', 'resourceId', 'requestId', 'metadata', 'createdAt'],
    {
      actorParticipantId: nonEmptyStringField,
      actorUserId: nonEmptyStringField,
      actionKey: nonEmptyStringField,
      resourceType: nonEmptyStringField,
      resourceId: nonEmptyStringField,
      contextId: nonEmptyStringField,
      requestId: nonEmptyStringField,
      metadata: { bsonType: 'object' },
      ipAddressHash: binaryField,
      userAgentSummary: { bsonType: 'string', maxLength: 500 },
      createdAt: dateField,
    },
  ),
  [COLLECTIONS.mediaObjects]: documentValidator(
    [
      'mediaKind',
      'uploadedByParticipantId',
      'storageProvider',
      'storageKey',
      'mediaType',
      'byteSize',
      'sha256Hash',
      'widthPixels',
      'heightPixels',
      'status',
      'createdAt',
      'updatedAt',
    ],
    {
      mediaKind: { bsonType: 'string', enum: ['USER_AVATAR', 'GROUP_IMAGE'] },
      ownerUserId: nonEmptyStringField,
      ownerGroupId: nonEmptyStringField,
      uploadedByParticipantId: nonEmptyStringField,
      storageProvider: { bsonType: 'string', enum: ['FILESYSTEM'] },
      storageKey: nonEmptyStringField,
      mediaType: { bsonType: 'string', enum: ['image/webp'] },
      byteSize: { bsonType: ['int', 'long'], minimum: 1, maximum: 25_000_000 },
      sha256Hash: binaryField,
      widthPixels: positiveIntegerField,
      heightPixels: positiveIntegerField,
      status: { bsonType: 'string', enum: ['ACTIVE', 'SUPERSEDED', 'DELETED'] },
      supersededAt: dateField,
      deletedAt: dateField,
      createdAt: dateField,
      updatedAt: dateField,
    },
    {
      oneOf: [
        {
          required: ['ownerUserId'],
          properties: { mediaKind: { enum: ['USER_AVATAR'] } },
          not: { required: ['ownerGroupId'] },
        },
        {
          required: ['ownerGroupId'],
          properties: { mediaKind: { enum: ['GROUP_IMAGE'] } },
          not: { required: ['ownerUserId'] },
        },
      ],
    },
  ),
});

// This is the canonical index manifest used by migrations, verification, and
// API/worker startup drift checks.
export const MONGO_INDEXES = Object.freeze([
  {
    collection: COLLECTIONS.users,
    indexes: [
      {
        key: { emailNormalized: 1 },
        name: 'uq_users_email',
        unique: true,
        partialFilterExpression: { emailNormalized: { $type: 'string' } },
      },
      {
        key: { mobileE164: 1 },
        name: 'uq_users_mobile',
        unique: true,
        partialFilterExpression: { mobileE164: { $type: 'string' } },
      },
    ],
  },
  {
    collection: COLLECTIONS.participants,
    indexes: [
      {
        key: { userId: 1 },
        name: 'uq_participant_user',
        unique: true,
        partialFilterExpression: { userId: { $type: 'string' } },
      },
    ],
  },
  {
    collection: COLLECTIONS.authTokens,
    indexes: [
      { key: { tokenHash: 1 }, name: 'uq_auth_token_hash', unique: true },
      { key: { userId: 1, tokenType: 1, createdAt: 1 }, name: 'ix_auth_token_user' },
      { key: { expiresAt: 1 }, name: 'ttl_auth_token_expiry', expireAfterSeconds: 0 },
    ],
  },
  {
    collection: COLLECTIONS.sessions,
    indexes: [
      { key: { sessionTokenHash: 1 }, name: 'uq_session_token', unique: true },
      { key: { sessionId: 1 }, name: 'uq_session_id', unique: true },
      { key: { userId: 1, active: 1, expiresAt: 1 }, name: 'ix_session_user' },
      { key: { expiresAt: 1 }, name: 'ttl_session_expiry', expireAfterSeconds: 0 },
    ],
  },
  {
    collection: COLLECTIONS.mobileOtpChallenges,
    indexes: [
      {
        key: { mobileE164: 1, purpose: 1 },
        name: 'uq_mobile_otp_slot',
        unique: true,
      },
      { key: { challengeId: 1 }, name: 'uq_mobile_otp_challenge_id', unique: true },
      {
        key: { mobileE164: 1, purpose: 1, status: 1, createdAt: -1, _id: 1 },
        name: 'ix_mobile_otp_phone',
      },
      { key: { requestIpHash: 1, createdAt: -1, _id: 1 }, name: 'ix_mobile_otp_ip' },
      { key: { purgeAt: 1 }, name: 'ttl_mobile_otp_retention', expireAfterSeconds: 0 },
    ],
  },
  {
    collection: COLLECTIONS.mobileOtpThrottles,
    indexes: [
      { key: { scope: 1, throttleKey: 1 }, name: 'uq_mobile_otp_throttle', unique: true },
      { key: { purgeAt: 1 }, name: 'ttl_mobile_otp_throttle', expireAfterSeconds: 0 },
      { key: { updatedAt: 1 }, name: 'ix_otp_throttle_age' },
    ],
  },
  {
    collection: COLLECTIONS.groups,
    indexes: [
      { key: { contextId: 1 }, name: 'uq_group_context', unique: true },
      { key: { updatedAt: -1, _id: 1 }, name: 'ix_group_updated' },
    ],
  },
  {
    collection: COLLECTIONS.contextMembers,
    indexes: [
      {
        key: { contextId: 1, participantId: 1 },
        name: 'uq_active_context_member',
        unique: true,
        partialFilterExpression: { status: 'ACTIVE' },
      },
      {
        key: { contextId: 1, allocationOrder: 1 },
        name: 'uq_active_allocation_order',
        unique: true,
        partialFilterExpression: { status: 'ACTIVE' },
      },
      { key: { participantId: 1, status: 1, contextId: 1 }, name: 'ix_member_participant' },
    ],
  },
  {
    collection: COLLECTIONS.invitations,
    indexes: [
      { key: { tokenHash: 1 }, name: 'uq_invitation_token', unique: true },
      { key: { contextId: 1, status: 1, createdAt: -1, _id: 1 }, name: 'ix_invite_context' },
      { key: { inviteeMobileE164: 1, status: 1, expiresAt: 1 }, name: 'ix_invite_mobile' },
      {
        key: { contextId: 1, inviteeMobileE164: 1 },
        name: 'uq_pending_group_mobile',
        unique: true,
        partialFilterExpression: {
          invitationType: 'GROUP',
          status: 'PENDING',
          inviteeMobileE164: { $type: 'string' },
        },
      },
    ],
  },
  {
    collection: COLLECTIONS.expenses,
    indexes: [
      {
        key: { contextId: 1, expenseDate: -1, createdAt: -1, _id: 1 },
        name: 'ix_expense_context_page',
      },
      { key: { createdByParticipantId: 1, createdAt: -1 }, name: 'ix_expense_creator' },
      {
        key: { contextId: 1, currencyCode: 1, categoryCode: 1, status: 1, expenseDate: 1 },
        name: 'ix_expense_filters',
      },
    ],
  },
  {
    collection: COLLECTIONS.expenseRevisions,
    indexes: [
      { key: { expenseId: 1, revisionNumber: 1 }, name: 'uq_expense_revision', unique: true },
      { key: { 'payers.participantId': 1, expenseId: 1 }, name: 'ix_payer_participant' },
      { key: { 'shares.participantId': 1, expenseId: 1 }, name: 'ix_share_participant' },
    ],
  },
  {
    collection: COLLECTIONS.ledgerBatches,
    indexes: [
      {
        key: { sourceType: 1, sourceId: 1, sourceRevisionId: 1 },
        name: 'uq_expense_source_revision',
        unique: true,
        partialFilterExpression: { batchType: 'EXPENSE', sourceType: 'EXPENSE' },
      },
      {
        key: { sourceType: 1, sourceId: 1, sourceRevisionId: 1 },
        name: 'uq_settlement_source_revision',
        unique: true,
        partialFilterExpression: { batchType: 'SETTLEMENT', sourceType: 'SETTLEMENT' },
      },
      {
        key: { reversesBatchId: 1 },
        name: 'uq_ledger_reversal',
        unique: true,
        partialFilterExpression: { reversesBatchId: { $type: 'string' } },
      },
      { key: { sourceType: 1, sourceId: 1, postedAt: 1 }, name: 'ix_ledger_source' },
      { key: { contextId: 1, currencyCode: 1, postedAt: 1, _id: 1 }, name: 'ix_ledger_context' },
      { key: { 'postings.participantId': 1, _id: 1 }, name: 'ix_posting_participant' },
    ],
  },
  {
    collection: COLLECTIONS.balanceProjections,
    indexes: [
      {
        key: { contextId: 1, participantId: 1, currencyCode: 1 },
        name: 'uq_balance_projection',
        unique: true,
      },
      { key: { participantId: 1, currencyCode: 1, contextId: 1 }, name: 'ix_balance_participant' },
    ],
  },
  {
    collection: COLLECTIONS.bilateralProjections,
    indexes: [
      {
        key: { contextId: 1, participantLowId: 1, participantHighId: 1, currencyCode: 1 },
        name: 'uq_bilateral_projection',
        unique: true,
      },
      { key: { participantHighId: 1, currencyCode: 1, contextId: 1 }, name: 'ix_bilateral_high' },
    ],
  },
  {
    collection: COLLECTIONS.settlements,
    indexes: [
      {
        key: { contextId: 1, currencyCode: 1, settlementDate: -1, _id: 1 },
        name: 'ix_settlement_context',
      },
      { key: { senderParticipantId: 1, createdAt: -1 }, name: 'ix_settlement_sender' },
      { key: { recipientParticipantId: 1, createdAt: -1 }, name: 'ix_settlement_recipient' },
    ],
  },
  {
    collection: COLLECTIONS.settlementRevisions,
    indexes: [
      { key: { settlementId: 1, revisionNumber: 1 }, name: 'uq_settlement_revision', unique: true },
    ],
  },
  {
    collection: COLLECTIONS.idempotencyKeys,
    indexes: [
      {
        key: { actorParticipantId: 1, operationKey: 1, keyHash: 1 },
        name: 'uq_idempotency_scope',
        unique: true,
      },
      { key: { expiresAt: 1, status: 1 }, name: 'ix_idempotency_expiry' },
      { key: { expiresAt: 1 }, name: 'ttl_idempotency_expiry', expireAfterSeconds: 0 },
    ],
  },
  {
    collection: COLLECTIONS.idempotencyReceipts,
    indexes: [
      {
        key: { actorParticipantId: 1, operationKey: 1, keyHash: 1, completedAt: -1 },
        name: 'ix_idempotency_receipt_scope',
      },
      {
        key: { resourceId: 1 },
        name: 'ix_idempotency_receipt_resource',
        partialFilterExpression: { resourceId: { $type: 'string' } },
      },
    ],
  },
  {
    collection: COLLECTIONS.outbox,
    indexes: [
      { key: { status: 1, availableAt: 1, createdAt: 1, _id: 1 }, name: 'ix_outbox_available' },
      { key: { status: 1, leasedUntil: 1 }, name: 'ix_outbox_lease' },
      { key: { aggregateType: 1, aggregateId: 1, createdAt: 1 }, name: 'ix_outbox_aggregate' },
    ],
  },
  {
    collection: COLLECTIONS.auditEvents,
    indexes: [
      { key: { resourceType: 1, resourceId: 1, createdAt: 1 }, name: 'ix_audit_resource' },
      { key: { contextId: 1, createdAt: 1, _id: 1 }, name: 'ix_audit_context' },
      { key: { actorUserId: 1, createdAt: 1 }, name: 'ix_audit_actor' },
    ],
  },
  {
    collection: COLLECTIONS.mediaObjects,
    indexes: [
      { key: { storageKey: 1 }, name: 'uq_media_storage_key', unique: true },
      {
        key: { ownerUserId: 1, status: 1, mediaKind: 1 },
        name: 'ix_media_active_user',
      },
      {
        key: { ownerGroupId: 1, status: 1, mediaKind: 1 },
        name: 'ix_media_active_group',
      },
      { key: { ownerUserId: 1, status: 1, createdAt: -1, _id: 1 }, name: 'ix_media_user' },
      { key: { ownerGroupId: 1, status: 1, createdAt: -1, _id: 1 }, name: 'ix_media_group' },
      { key: { uploadedByParticipantId: 1, createdAt: -1, _id: 1 }, name: 'ix_media_uploader' },
    ],
  },
]);

export async function ensureMongoSchema(database) {
  const existing = new Set(
    (await database.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name),
  );

  for (const name of Object.values(COLLECTIONS)) {
    const validator = COLLECTION_VALIDATORS[name];
    const options = { validator, validationLevel: 'strict', validationAction: 'error' };
    if (!existing.has(name)) {
      await database.createCollection(name, options);
    } else {
      await database.command({ collMod: name, ...options });
    }
  }

  for (const definition of MONGO_INDEXES) {
    if (definition.indexes.length > 0) {
      await database.collection(definition.collection).createIndexes(definition.indexes);
    }
  }
}

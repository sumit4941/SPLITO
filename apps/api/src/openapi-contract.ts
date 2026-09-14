import type {
  OpenAPIObject,
  OperationObject,
  ParameterObject,
  ReferenceObject,
  RequestBodyObject,
  ResponseObject,
  SchemaObject,
} from '@nestjs/swagger';
import { z, type ZodType } from 'zod';
import {
  loginSchema,
  registerSchema,
  requestMobileOtpSchema,
  verifyEmailSchema,
  verifyMobileOtpSchema,
} from './auth/auth.schemas.js';
import { expenseMutationSchema } from './expenses/expenses.schemas.js';
import {
  addGroupMemberSchema,
  createGroupSchema,
  groupInvitationTokenSchema,
} from './groups/groups.schemas.js';
import {
  createSettlementSchema,
  settlementPreviewSchema,
} from './settlements/settlements.schemas.js';

const ref = (name: string): ReferenceObject => ({ $ref: `#/components/schemas/${name}` });
const responseRef = (name: string): ReferenceObject => ({
  $ref: `#/components/responses/${name}`,
});

function zodToSchema(schema: ZodType): SchemaObject {
  const generated = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  Reflect.deleteProperty(generated, '$schema');
  return generated as SchemaObject;
}

function dataEnvelope(data: SchemaObject | ReferenceObject): SchemaObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['data'],
    properties: { data },
  };
}

function jsonResponse(
  description: string,
  schema: SchemaObject | ReferenceObject,
  headers?: ResponseObject['headers'],
): ResponseObject {
  return {
    description,
    ...(headers ? { headers } : {}),
    content: { 'application/json': { schema } },
  };
}

function imageResponse(description: string): ResponseObject {
  return {
    description,
    headers: {
      'Cache-Control': {
        schema: { type: 'string', enum: ['private, no-store'] },
      },
      ETag: { schema: { type: 'string' } },
      Vary: { schema: { type: 'string', enum: ['Cookie'] } },
      'X-Content-Type-Options': { schema: { type: 'string', enum: ['nosniff'] } },
    },
    content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } },
  };
}

type HttpMethod = 'get' | 'post' | 'put' | 'delete';

function operation(document: OpenAPIObject, path: string, method: HttpMethod): OperationObject {
  const selected = document.paths[path]?.[method];
  if (!selected) throw new Error(`OpenAPI operation missing: ${method.toUpperCase()} ${path}`);
  return selected;
}

function body(name: string): RequestBodyObject {
  return {
    required: true,
    content: { 'application/json': { schema: ref(name) } },
  };
}

function imageUploadBody(): RequestBodyObject {
  return {
    required: true,
    content: {
      'multipart/form-data': {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['file'],
          properties: {
            file: {
              type: 'string',
              format: 'binary',
              description: 'One JPEG, PNG, or WebP image, at most 10,000,000 bytes.',
            },
          },
        },
      },
    },
  };
}

const canonicalId: SchemaObject = {
  type: 'string',
  pattern: '^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$',
  example: '2f40d889-89f7-4fcb-99f0-8702f88d0c77',
};
const unsignedMinor: SchemaObject = {
  type: 'string',
  pattern: '^(?:0|[1-9][0-9]{0,18})$',
  description: 'Integer minor units serialized as a decimal string.',
  example: '1250',
};
const signedMinor: SchemaObject = {
  type: 'string',
  pattern: '^(?:0|-?[1-9][0-9]{0,18})$',
  description: 'Signed integer minor units serialized as a decimal string.',
  example: '-1250',
};
const currency: SchemaObject = { type: 'string', pattern: '^[A-Z]{3}$', example: 'INR' };
const date: SchemaObject = { type: 'string', format: 'date', example: '2026-09-12' };
const dateTime: SchemaObject = { type: 'string', format: 'date-time' };

const errorResponses: OperationObject['responses'] = {
  '400': responseRef('BadRequest'),
  '401': responseRef('Unauthorized'),
  '403': responseRef('Forbidden'),
  '404': responseRef('NotFound'),
  '409': responseRef('Conflict'),
  '412': responseRef('PreconditionFailed'),
  '413': responseRef('PayloadTooLarge'),
  '415': responseRef('UnsupportedMediaType'),
  '422': responseRef('UnprocessableEntity'),
  '428': responseRef('PreconditionRequired'),
  '429': responseRef('RateLimited'),
  '500': responseRef('InternalError'),
  '502': responseRef('BadGateway'),
  '503': responseRef('ServiceUnavailable'),
};

const groupIdParameter: ParameterObject = {
  name: 'groupId',
  in: 'path',
  required: true,
  schema: canonicalId,
};
const participantIdParameter: ParameterObject = {
  name: 'participantId',
  in: 'path',
  required: true,
  schema: canonicalId,
};
const mediaVersionParameter: ParameterObject = {
  name: 'v',
  in: 'query',
  required: true,
  description: 'Immutable media identifier from the URL returned by the upload or resource API.',
  schema: canonicalId,
};
const expenseIdParameter: ParameterObject = {
  name: 'expenseId',
  in: 'path',
  required: true,
  schema: canonicalId,
};
const idempotencyParameter: ParameterObject = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  description: 'Stable 8–200 character key. Reuse is valid only with the identical request body.',
  schema: { type: 'string', minLength: 8, maxLength: 200 },
};
const ifMatchParameter: ParameterObject = {
  name: 'If-Match',
  in: 'header',
  required: true,
  description: 'Current positive decimal expense version, optionally enclosed in double quotes.',
  schema: { type: 'string', pattern: '^(?:"[1-9][0-9]{0,18}"|[1-9][0-9]{0,18})$' },
};

export function applyOpenApiContract(document: OpenAPIObject): OpenAPIObject {
  document.servers = [{ url: '/', description: 'Current SPLITO deployment' }];
  document.components ??= {};
  document.components.schemas = {
    RegisterRequest: zodToSchema(registerSchema),
    VerifyEmailRequest: zodToSchema(verifyEmailSchema),
    LoginRequest: zodToSchema(loginSchema),
    RequestMobileOtpRequest: zodToSchema(requestMobileOtpSchema),
    VerifyMobileOtpRequest: zodToSchema(verifyMobileOtpSchema),
    CreateGroupRequest: zodToSchema(createGroupSchema),
    AddGroupMemberRequest: zodToSchema(addGroupMemberSchema),
    GroupInvitationTokenRequest: zodToSchema(groupInvitationTokenSchema),
    ExpenseMutationRequest: zodToSchema(expenseMutationSchema),
    SettlementPreviewRequest: zodToSchema(settlementPreviewSchema),
    CreateSettlementRequest: zodToSchema(createSettlementSchema),
    ErrorEnvelope: {
      type: 'object',
      additionalProperties: false,
      required: ['error'],
      properties: {
        error: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'message', 'requestId'],
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
            requestId: canonicalId,
            fieldErrors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['field', 'message'],
                properties: { field: { type: 'string' }, message: { type: 'string' } },
              },
            },
          },
        },
      },
    },
    User: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'userId',
        'participantId',
        'displayName',
        'locale',
        'timezone',
        'defaultCurrency',
        'theme',
        'reducedMotion',
        'version',
      ],
      properties: {
        id: canonicalId,
        userId: canonicalId,
        participantId: canonicalId,
        email: { type: 'string', format: 'email' },
        mobileNumber: {
          type: 'string',
          pattern: '^\\+[1-9][0-9]{7,14}$',
          description: 'Verified mobile identity in canonical E.164 form.',
        },
        displayName: { type: 'string' },
        avatarUrl: { type: 'string', example: '/api/v1/participants/id/avatar?v=media-id' },
        locale: { type: 'string' },
        timezone: { type: 'string' },
        defaultCurrency: currency,
        theme: { type: 'string', enum: ['light', 'dark', 'system'] },
        reducedMotion: { type: 'boolean' },
        version: { type: 'string' },
      },
    },
    MobileOtpChallenge: {
      type: 'object',
      additionalProperties: false,
      required: ['challengeId', 'maskedMobileNumber', 'expiresInSeconds', 'resendAfterSeconds'],
      properties: {
        challengeId: canonicalId,
        maskedMobileNumber: { type: 'string', example: '+********3210' },
        expiresInSeconds: { type: 'integer', enum: [300] },
        resendAfterSeconds: { type: 'integer', enum: [60] },
        developmentOtp: {
          type: 'string',
          pattern: '^[0-9]{6}$',
          description: 'Present only in development; never persisted or emitted in production.',
        },
      },
    },
    MobileOtpVerification: {
      type: 'object',
      additionalProperties: false,
      required: ['user', 'isNewAccount'],
      properties: {
        user: ref('User'),
        isNewAccount: {
          type: 'boolean',
          description: 'True only when verification provisioned the account in this transaction.',
        },
      },
    },
    RegistrationResult: {
      type: 'object',
      additionalProperties: false,
      required: ['verificationRequired'],
      properties: {
        userId: canonicalId,
        verificationRequired: { type: 'boolean', enum: [true] },
        developmentVerificationToken: {
          type: 'string',
          description: 'Present only in development; never emitted in production.',
        },
      },
    },
    Group: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'contextId',
        'name',
        'type',
        'defaultCurrency',
        'simplificationEnabled',
        'archived',
        'role',
        'memberCount',
        'version',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        id: canonicalId,
        contextId: canonicalId,
        name: { type: 'string' },
        description: { type: 'string' },
        imageUrl: { type: 'string', example: '/api/v1/groups/id/image?v=media-id' },
        type: { type: 'string', enum: ['home', 'trip', 'couple', 'family', 'project', 'other'] },
        defaultCurrency: currency,
        simplificationEnabled: { type: 'boolean' },
        archived: { type: 'boolean' },
        role: { type: 'string', enum: ['owner', 'administrator', 'member'] },
        memberCount: { type: 'integer', minimum: 0 },
        version: { type: 'string' },
        createdAt: dateTime,
        updatedAt: dateTime,
      },
    },
    GroupMember: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'displayName', 'kind', 'role', 'status', 'allocationOrder'],
      properties: {
        id: canonicalId,
        displayName: { type: 'string' },
        avatarUrl: { type: 'string', example: '/api/v1/participants/id/avatar?v=media-id' },
        kind: { type: 'string', enum: ['USER', 'GUEST'] },
        role: { type: 'string', enum: ['owner', 'administrator', 'member', 'guest'] },
        status: { type: 'string', enum: ['active', 'former'] },
        allocationOrder: { type: 'integer', minimum: 0 },
      },
    },
    PendingGroupInvitation: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'maskedMobileNumber', 'expiresAt', 'status'],
      properties: {
        id: canonicalId,
        maskedMobileNumber: { type: 'string', example: '+********3210' },
        expiresAt: dateTime,
        status: { type: 'string', enum: ['pending'] },
      },
    },
    RegisteredGroupMemberResult: {
      type: 'object',
      additionalProperties: false,
      required: ['outcome', 'member'],
      properties: {
        outcome: { type: 'string', enum: ['member_added'] },
        member: ref('GroupMember'),
      },
    },
    GroupInvitationSentResult: {
      type: 'object',
      additionalProperties: false,
      required: ['outcome', 'invitation'],
      properties: {
        outcome: { type: 'string', enum: ['invitation_sent'] },
        invitation: ref('PendingGroupInvitation'),
        developmentJoinUrl: {
          type: 'string',
          format: 'uri',
          description: 'Development-only captured join URL; never returned in production.',
        },
      },
    },
    GroupInvitationPreview: {
      type: 'object',
      additionalProperties: false,
      required: ['invitationId', 'groupId', 'groupName', 'inviterDisplayName', 'expiresAt'],
      properties: {
        invitationId: canonicalId,
        groupId: canonicalId,
        groupName: { type: 'string' },
        inviterDisplayName: { type: 'string' },
        expiresAt: dateTime,
      },
    },
    GroupInvitationAcceptance: {
      type: 'object',
      additionalProperties: false,
      required: ['outcome', 'groupId', 'groupName', 'member'],
      properties: {
        outcome: { type: 'string', enum: ['joined'] },
        groupId: canonicalId,
        groupName: { type: 'string' },
        member: ref('GroupMember'),
      },
    },
    GroupDetail: {
      allOf: [
        ref('Group'),
        {
          type: 'object',
          required: ['members', 'pendingInvitations'],
          properties: {
            members: { type: 'array', items: ref('GroupMember') },
            pendingInvitations: {
              type: 'array',
              description:
                'Pending mobile invitations, visible only to group owners and administrators.',
              items: ref('PendingGroupInvitation'),
            },
          },
        },
      ],
    },
    MediaMutation: {
      type: 'object',
      additionalProperties: false,
      required: ['url', 'version'],
      properties: {
        url: {
          type: 'string',
          description: 'Cookie-authenticated, versioned, same-origin image URL.',
        },
        version: canonicalId,
      },
    },
    SplitPreviewLine: {
      type: 'object',
      additionalProperties: false,
      required: [
        'participantId',
        'displayName',
        'paidAmountMinor',
        'owedAmountMinor',
        'netAmountMinor',
      ],
      properties: {
        participantId: canonicalId,
        displayName: { type: 'string' },
        paidAmountMinor: unsignedMinor,
        owedAmountMinor: unsignedMinor,
        netAmountMinor: signedMinor,
      },
    },
    SplitPreview: {
      type: 'object',
      additionalProperties: false,
      required: ['currency', 'totalAmountMinor', 'allocations', 'explanation', 'algorithmVersion'],
      properties: {
        currency,
        totalAmountMinor: unsignedMinor,
        allocations: { type: 'array', items: ref('SplitPreviewLine') },
        explanation: { type: 'string' },
        algorithmVersion: { type: 'string' },
      },
    },
    ExpensePayer: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'displayName', 'paidAmountMinor'],
      properties: {
        id: canonicalId,
        displayName: { type: 'string' },
        paidAmountMinor: unsignedMinor,
      },
    },
    ExpenseAllocation: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'displayName', 'owedAmountMinor', 'netAmountMinor'],
      properties: {
        id: canonicalId,
        displayName: { type: 'string' },
        owedAmountMinor: unsignedMinor,
        netAmountMinor: signedMinor,
        inputValue: { type: 'string' },
      },
    },
    Expense: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'description',
        'amount',
        'expenseDate',
        'category',
        'groupId',
        'groupName',
        'status',
        'version',
        'payers',
        'allocations',
        'revisionNumber',
        'createdBy',
        'canEdit',
      ],
      properties: {
        id: canonicalId,
        description: { type: 'string' },
        amount: {
          type: 'object',
          additionalProperties: false,
          required: ['amountMinor', 'currency'],
          properties: { amountMinor: unsignedMinor, currency },
        },
        expenseDate: date,
        category: { type: 'string' },
        groupId: canonicalId,
        groupName: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'posted', 'voided'] },
        version: { type: 'string' },
        notes: { type: 'string' },
        payers: { type: 'array', items: ref('ExpensePayer') },
        allocations: { type: 'array', items: ref('ExpenseAllocation') },
        revisionNumber: { type: 'integer', minimum: 1 },
        splitMethod: {
          type: 'string',
          enum: ['equal', 'exact', 'percentage', 'shares', 'adjustments'],
        },
        algorithmVersion: { type: 'string' },
        createdBy: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'displayName'],
          properties: { id: canonicalId, displayName: { type: 'string' } },
        },
        canEdit: {
          type: 'boolean',
          description:
            'True only for the active member who originally created this posted expense.',
        },
      },
    },
    ExpensePage: {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: { type: 'array', items: ref('Expense') },
        nextCursor: { type: 'string' },
      },
    },
    BalanceLine: {
      type: 'object',
      additionalProperties: false,
      required: [
        'currency',
        'netAmountMinor',
        'owedAmountMinor',
        'receivableAmountMinor',
        'contextId',
        'contextName',
        'version',
      ],
      properties: {
        currency,
        netAmountMinor: signedMinor,
        owedAmountMinor: unsignedMinor,
        receivableAmountMinor: unsignedMinor,
        contextId: canonicalId,
        contextName: { type: 'string' },
        version: { type: 'string' },
      },
    },
    SettlementPreview: {
      type: 'object',
      additionalProperties: false,
      required: ['overpayment', 'outstandingAmountMinor', 'previewVersion', 'explanation'],
      properties: {
        overpayment: { type: 'boolean' },
        outstandingAmountMinor: unsignedMinor,
        previewVersion: { type: 'string', minLength: 64, maxLength: 64 },
        explanation: { type: 'string' },
      },
    },
    SettlementCreated: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'version', 'status', 'userAssertion'],
      properties: {
        id: canonicalId,
        version: { type: 'string' },
        status: { type: 'string', enum: ['posted'] },
        userAssertion: { type: 'boolean', enum: [true] },
      },
    },
    LiveStatus: {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: { status: { type: 'string', enum: ['ok'] } },
    },
    ReadyStatus: {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: { status: { type: 'string', enum: ['ok'] } },
    },
    RegistrationEnvelope: dataEnvelope(ref('RegistrationResult')),
    UserEnvelope: dataEnvelope(ref('User')),
    MobileOtpChallengeEnvelope: dataEnvelope(ref('MobileOtpChallenge')),
    MobileOtpVerificationEnvelope: dataEnvelope(ref('MobileOtpVerification')),
    GroupEnvelope: dataEnvelope(ref('Group')),
    GroupListEnvelope: dataEnvelope({ type: 'array', items: ref('Group') }),
    GroupDetailEnvelope: dataEnvelope(ref('GroupDetail')),
    RegisteredGroupMemberEnvelope: dataEnvelope(ref('RegisteredGroupMemberResult')),
    GroupInvitationSentEnvelope: dataEnvelope(ref('GroupInvitationSentResult')),
    GroupInvitationPreviewEnvelope: dataEnvelope(ref('GroupInvitationPreview')),
    GroupInvitationAcceptanceEnvelope: dataEnvelope(ref('GroupInvitationAcceptance')),
    MediaMutationEnvelope: dataEnvelope(ref('MediaMutation')),
    SplitPreviewEnvelope: dataEnvelope(ref('SplitPreview')),
    ExpenseEnvelope: dataEnvelope(ref('Expense')),
    ExpensePageEnvelope: dataEnvelope(ref('ExpensePage')),
    BalanceListEnvelope: dataEnvelope({ type: 'array', items: ref('BalanceLine') }),
    SettlementPreviewEnvelope: dataEnvelope(ref('SettlementPreview')),
    SettlementCreatedEnvelope: dataEnvelope(ref('SettlementCreated')),
  };

  const errorResponse = (description: string): ResponseObject =>
    jsonResponse(description, ref('ErrorEnvelope'));
  document.components.responses = {
    BadRequest: errorResponse('Malformed input or identifier.'),
    Unauthorized: errorResponse('A valid session is required.'),
    Forbidden: errorResponse('The authenticated identity is not authorized.'),
    NotFound: errorResponse('The resource does not exist or is not visible to this identity.'),
    Conflict: errorResponse(
      'The resource version, idempotency body, or financial state conflicts.',
    ),
    PreconditionFailed: errorResponse('The supplied resource version is stale.'),
    PayloadTooLarge: errorResponse('The uploaded file or multipart request exceeds its limit.'),
    UnsupportedMediaType: errorResponse('The upload is not an accepted image or multipart body.'),
    UnprocessableEntity: errorResponse('The financial-domain invariant was not satisfied.'),
    PreconditionRequired: errorResponse('A required optimistic-concurrency header is missing.'),
    RateLimited: jsonResponse('The request rate limit was exceeded.', ref('ErrorEnvelope'), {
      'Retry-After': {
        description: 'Minimum seconds before retrying; 60 for cooldown or up to 900 for quota.',
        schema: { type: 'integer', minimum: 1, maximum: 900 },
      },
    }),
    InternalError: errorResponse('An unexpected server error occurred.'),
    BadGateway: errorResponse('The external SMS provider did not accept the invitation message.'),
    ServiceUnavailable: errorResponse('A required external delivery adapter is unavailable.'),
  };

  const set = (
    path: string,
    method: HttpMethod,
    successStatus: '200' | '201' | '202' | '204',
    success: ResponseObject,
    options: {
      requestBody?: string | RequestBodyObject;
      parameters?: ParameterObject[];
      security?: 'session' | 'mutation';
    } = {},
  ): void => {
    const selected = operation(document, path, method);
    selected.responses = {
      [successStatus]: success,
      ...(successStatus === '204' ? {} : errorResponses),
    };
    if (options.requestBody) {
      selected.requestBody =
        typeof options.requestBody === 'string' ? body(options.requestBody) : options.requestBody;
    }
    if (options.parameters) selected.parameters = options.parameters;
    if (options.security === 'session') selected.security = [{ session: [] }];
    if (options.security === 'mutation') selected.security = [{ session: [], csrf: [] }];
  };

  set('/api/v1/health/live', 'get', '200', jsonResponse('Process is live.', ref('LiveStatus')));
  set('/api/v1/health/ready', 'get', '200', jsonResponse('Service is ready.', ref('ReadyStatus')));
  set(
    '/api/v1/auth/register',
    'post',
    '201',
    jsonResponse('Registration accepted.', ref('RegistrationEnvelope')),
    {
      requestBody: 'RegisterRequest',
    },
  );
  set(
    '/api/v1/auth/verify-email',
    'post',
    '204',
    { description: 'Email verified.' },
    {
      requestBody: 'VerifyEmailRequest',
    },
  );
  set('/api/v1/auth/login', 'post', '200', jsonResponse('Session created.', ref('UserEnvelope')), {
    requestBody: 'LoginRequest',
  });
  set(
    '/api/v1/auth/mobile/request-otp',
    'post',
    '202',
    jsonResponse('Mobile OTP challenge accepted.', ref('MobileOtpChallengeEnvelope'), {
      'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } },
    }),
    { requestBody: 'RequestMobileOtpRequest' },
  );
  operation(document, '/api/v1/auth/mobile/request-otp', 'post').description =
    'Enumeration-safe OTP request. Development returns the code explicitly; production fails closed until an external SMS adapter is configured.';
  set(
    '/api/v1/auth/mobile/verify-otp',
    'post',
    '200',
    jsonResponse(
      'Mobile OTP verified and sole active session created.',
      ref('MobileOtpVerificationEnvelope'),
      { 'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } } },
    ),
    { requestBody: 'VerifyMobileOtpRequest' },
  );
  set(
    '/api/v1/auth/logout',
    'post',
    '204',
    { description: 'Session revoked.' },
    {
      security: 'mutation',
    },
  );
  set('/api/v1/auth/session', 'get', '200', jsonResponse('Current session.', ref('UserEnvelope')), {
    security: 'session',
  });
  set('/api/v1/me', 'get', '200', jsonResponse('Current user.', ref('UserEnvelope')), {
    security: 'session',
  });
  set(
    '/api/v1/me/avatar',
    'put',
    '200',
    jsonResponse('Avatar replaced.', ref('MediaMutationEnvelope')),
    {
      requestBody: imageUploadBody(),
      security: 'mutation',
    },
  );
  set(
    '/api/v1/me/avatar',
    'delete',
    '204',
    { description: 'Avatar deleted.' },
    {
      security: 'mutation',
    },
  );
  set(
    '/api/v1/participants/{participantId}/avatar',
    'get',
    '200',
    imageResponse('Authorized versioned private participant avatar.'),
    {
      parameters: [participantIdParameter, mediaVersionParameter],
      security: 'session',
    },
  );
  set('/api/v1/groups', 'get', '200', jsonResponse('Visible groups.', ref('GroupListEnvelope')), {
    security: 'session',
  });
  set('/api/v1/groups', 'post', '201', jsonResponse('Group created.', ref('GroupEnvelope')), {
    requestBody: 'CreateGroupRequest',
    security: 'mutation',
  });
  set(
    '/api/v1/groups/{groupId}/members',
    'post',
    '201',
    jsonResponse(
      'A registered account was added to the group.',
      ref('RegisteredGroupMemberEnvelope'),
    ),
    {
      requestBody: 'AddGroupMemberRequest',
      parameters: [groupIdParameter],
      security: 'mutation',
    },
  );
  operation(document, '/api/v1/groups/{groupId}/members', 'post').responses['202'] = jsonResponse(
    'The account is not registered; a phone-bound registration and join invitation was sent.',
    ref('GroupInvitationSentEnvelope'),
  );
  set(
    '/api/v1/groups/{groupId}',
    'get',
    '200',
    jsonResponse('Group details.', ref('GroupDetailEnvelope')),
    {
      parameters: [groupIdParameter],
      security: 'session',
    },
  );
  set(
    '/api/v1/group-invitations/preview',
    'post',
    '200',
    jsonResponse(
      'Invitation details for the signed-in phone number.',
      ref('GroupInvitationPreviewEnvelope'),
    ),
    {
      requestBody: 'GroupInvitationTokenRequest',
      security: 'session',
    },
  );
  set(
    '/api/v1/group-invitations/accept',
    'post',
    '200',
    jsonResponse(
      'Invitation accepted and membership activated.',
      ref('GroupInvitationAcceptanceEnvelope'),
    ),
    {
      requestBody: 'GroupInvitationTokenRequest',
      security: 'mutation',
    },
  );
  set(
    '/api/v1/groups/{groupId}/image',
    'put',
    '200',
    jsonResponse('Group image replaced.', ref('MediaMutationEnvelope')),
    {
      requestBody: imageUploadBody(),
      parameters: [groupIdParameter],
      security: 'mutation',
    },
  );
  set(
    '/api/v1/groups/{groupId}/image',
    'delete',
    '204',
    { description: 'Group image deleted.' },
    {
      parameters: [groupIdParameter],
      security: 'mutation',
    },
  );
  set(
    '/api/v1/groups/{groupId}/image',
    'get',
    '200',
    imageResponse('Authorized versioned private group image.'),
    {
      parameters: [groupIdParameter, mediaVersionParameter],
      security: 'session',
    },
  );
  set(
    '/api/v1/expenses/split-preview',
    'post',
    '200',
    jsonResponse('Authoritative split preview.', ref('SplitPreviewEnvelope')),
    {
      requestBody: 'ExpenseMutationRequest',
      security: 'session',
    },
  );
  set(
    '/api/v1/expenses',
    'post',
    '201',
    jsonResponse('Expense posted.', ref('ExpenseEnvelope'), {
      Location: { schema: { type: 'string' } },
      'Idempotency-Replayed': { schema: { type: 'string', enum: ['true'] } },
    }),
    {
      requestBody: 'ExpenseMutationRequest',
      parameters: [idempotencyParameter],
      security: 'mutation',
    },
  );
  set(
    '/api/v1/expenses/{expenseId}',
    'get',
    '200',
    jsonResponse('Expense details.', ref('ExpenseEnvelope'), {
      ETag: { schema: { type: 'string' } },
    }),
    {
      parameters: [expenseIdParameter],
      security: 'session',
    },
  );
  set(
    '/api/v1/expenses/{expenseId}',
    'put',
    '200',
    jsonResponse(
      'Expense replaced by an immutable revision and balanced journal reversal.',
      ref('ExpenseEnvelope'),
      {
        ETag: { schema: { type: 'string' } },
        'Idempotency-Replayed': { schema: { type: 'string', enum: ['true'] } },
      },
    ),
    {
      requestBody: 'ExpenseMutationRequest',
      parameters: [expenseIdParameter, idempotencyParameter, ifMatchParameter],
      security: 'mutation',
    },
  );
  set(
    '/api/v1/groups/{groupId}/expenses',
    'get',
    '200',
    jsonResponse('Expense page.', ref('ExpensePageEnvelope')),
    {
      parameters: [
        groupIdParameter,
        { name: 'cursor', in: 'query', schema: { type: 'string', maxLength: 1_000 } },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
        },
      ],
      security: 'session',
    },
  );
  set(
    '/api/v1/balances',
    'get',
    '200',
    jsonResponse('Personal balances.', ref('BalanceListEnvelope')),
    {
      security: 'session',
    },
  );
  set(
    '/api/v1/groups/{groupId}/balances',
    'get',
    '200',
    jsonResponse('Group balances.', ref('BalanceListEnvelope')),
    {
      parameters: [groupIdParameter],
      security: 'session',
    },
  );
  set(
    '/api/v1/settlements/preview',
    'post',
    '200',
    jsonResponse('Settlement preview.', ref('SettlementPreviewEnvelope')),
    {
      requestBody: 'SettlementPreviewRequest',
      security: 'session',
    },
  );
  set(
    '/api/v1/settlements',
    'post',
    '201',
    jsonResponse('Settlement posted.', ref('SettlementCreatedEnvelope'), {
      Location: { schema: { type: 'string' } },
      'Idempotency-Replayed': { schema: { type: 'string', enum: ['true'] } },
    }),
    {
      requestBody: 'CreateSettlementRequest',
      parameters: [idempotencyParameter],
      security: 'mutation',
    },
  );

  return document;
}

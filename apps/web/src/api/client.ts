import { createSplitoClient, type SplitoApiSchemas } from '@splito/api-client';
import type {
  ActivityItem,
  AnalyticsResponse,
  BalanceLine,
  CursorPage,
  ExpenseSummary,
  GroupDetail,
  GroupSummary,
  Participant,
  ReceiptRecord,
  RecurringTemplate,
  SessionRecord,
  SplitPreview,
  UserProfile,
} from '../types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(/\/$/, '');
const GENERATED_API_BASE = API_BASE.endsWith('/api/v1') ? API_BASE.slice(0, -'/api/v1'.length) : '';
const generatedApi = createSplitoClient({ baseUrl: GENERATED_API_BASE, credentials: 'include' });

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    fieldErrors?: Array<{ field: string; message: string }>;
    requestId?: string;
  };
  code?: string;
  message?: string;
}

const SAFE_API_ERROR_MESSAGES = new Map<string, string>([
  ['ACCOUNT_NOT_ACTIVE', 'This account is not available for sign-in.'],
  ['ANIMATED_IMAGE_NOT_ALLOWED', 'Animated images are not supported.'],
  ['AUTHENTICATION_REQUIRED', 'Please sign in to continue.'],
  ['CONTEXT_ARCHIVED', 'This group is archived and cannot be changed.'],
  ['CSRF_VALIDATION_FAILED', 'Your session needs to be refreshed. Reload the page and try again.'],
  ['DUPLICATE_BENEFICIARY', 'Each person can appear only once in the split.'],
  ['DUPLICATE_PAYER', 'Each payer can appear only once.'],
  ['EXPENSE_EDIT_FORBIDDEN', 'Only the person who added this expense can edit it.'],
  ['EXPENSE_NOT_EDITABLE', 'This expense can no longer be edited.'],
  ['EXPENSE_NOT_FOUND', 'This expense is not available.'],
  ['GROUP_ARCHIVED', 'This group is archived and cannot be changed.'],
  ['GROUP_INVITATION_NOT_FOUND', 'This invitation is invalid or has expired.'],
  ['GROUP_MEMBERSHIP_FORBIDDEN', 'You do not have permission to make this change.'],
  ['GROUP_NOT_FOUND', 'This group is not available.'],
  ['IDEMPOTENCY_REQUEST_IN_PROGRESS', 'This change is still being processed. Try again shortly.'],
  ['IMAGE_FILE_EMPTY', 'Choose a non-empty image.'],
  ['IMAGE_FILE_REQUIRED', 'Choose an image to upload.'],
  ['IMAGE_NOT_FOUND', 'This image is not available.'],
  ['IMAGE_PIXEL_LIMIT_EXCEEDED', 'This image is too large. Choose a smaller image.'],
  ['IMAGE_TOO_LARGE', 'This image is too large. Choose a smaller image.'],
  ['IMAGE_TYPE_MISMATCH', 'The selected file does not match its image type.'],
  ['IMAGE_UPLOAD_LIMIT_EXCEEDED', 'Too many images were selected. Upload one image at a time.'],
  ['INVALID_CREDENTIALS', 'Those sign-in details are not correct.'],
  ['INVALID_IMAGE', 'Choose a valid JPEG, PNG, or WebP image.'],
  ['INVALID_OR_EXPIRED_OTP', 'That verification code is incorrect or has expired.'],
  ['INVALID_OR_EXPIRED_TOKEN', 'This link is invalid or has expired.'],
  ['INVITATION_RESEND_LIMIT', 'An invitation was sent recently. Wait a little and try again.'],
  ['INVITATION_SMS_DELIVERY_FAILED', 'We could not send the invitation text. Try again later.'],
  ['INVITATION_SMS_NOT_CONFIGURED', 'Invitation texts are temporarily unavailable.'],
  ['INVITEE_ACCOUNT_UNAVAILABLE', 'That person cannot be added right now.'],
  ['MEDIA_STORAGE_UNAVAILABLE', 'Images are temporarily unavailable. Try again later.'],
  ['MULTIPART_IMAGE_REQUIRED', 'Choose a JPEG, PNG, or WebP image to upload.'],
  ['NETWORK_ERROR', 'We could not connect. Check your internet connection and try again.'],
  ['OTP_DELIVERY_FAILED', 'We could not send the verification code. Try again later.'],
  ['OTP_DELIVERY_NOT_CONFIGURED', 'Text-message verification is temporarily unavailable.'],
  ['OTP_RATE_LIMITED', 'Too many verification attempts. Wait a little and try again.'],
  ['OVERPAYMENT_CONFIRMATION_REQUIRED', 'Review and confirm the overpayment before continuing.'],
  ['PARTICIPANT_NOT_ELIGIBLE', 'One or more selected people cannot be included.'],
  ['RESOURCE_VERSION_MISMATCH', 'This information changed. Refresh the page and try again.'],
  ['SESSION_EXPIRED', 'Your session has ended. Sign in again.'],
  ['SETTLEMENT_FORBIDDEN', 'You do not have permission to record this payment.'],
  ['STALE_SETTLEMENT_PREVIEW', 'Balances changed. Refresh the preview and try again.'],
  ['UNSUPPORTED_CURRENCY', 'That currency is not currently supported.'],
  ['UNSUPPORTED_IMAGE_TYPE', 'Choose a JPEG, PNG, or WebP image.'],
  ['VALIDATION_FAILED', 'Check the information you entered and try again.'],
]);

function defaultApiErrorMessage(status: number): string {
  if (status === 0) return 'We could not connect. Check your internet connection and try again.';
  if (status === 400 || status === 422) {
    return 'Check the information you entered and try again.';
  }
  if (status === 401) return 'Please sign in to continue.';
  if (status === 403) return 'You do not have permission to do that.';
  if (status === 404) return 'This information is not available.';
  if (status === 408) return 'That took too long. Please try again.';
  if (status === 409 || status === 412 || status === 428) {
    return 'This information changed. Refresh the page and try again.';
  }
  if (status === 413) return 'The selected file is too large.';
  if (status === 415) return 'That file type is not supported.';
  if (status === 429) return 'Too many attempts. Wait a little and try again.';
  if (status >= 500) return 'Something went wrong on our side. Please try again.';
  return 'We could not complete that action. Please try again.';
}

function safeApiErrorMessage(code: string, status: number): string {
  return SAFE_API_ERROR_MESSAGES.get(code) ?? defaultApiErrorMessage(status);
}

export class ApiError extends Error {
  readonly code: string;
  readonly fieldErrors?: Array<{ field: string; message: string }>;
  readonly requestId?: string;
  readonly status: number;

  constructor(status: number, body: ApiErrorBody) {
    const detail = body.error ?? body;
    const code = detail.code ?? `HTTP_${status}`;
    super(safeApiErrorMessage(code, status));
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fieldErrors = 'fieldErrors' in detail ? detail.fieldErrors : undefined;
    this.requestId = 'requestId' in detail ? detail.requestId : undefined;
  }
}

interface GeneratedResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

async function generatedResult<T>(request: Promise<GeneratedResult<T>>): Promise<T> {
  let result: GeneratedResult<T>;
  try {
    result = await request;
  } catch {
    throw new ApiError(0, { error: { code: 'NETWORK_ERROR' } });
  }
  if (result.error !== undefined || !result.response.ok) {
    const body =
      typeof result.error === 'object' && result.error !== null
        ? (result.error as ApiErrorBody)
        : {};
    throw new ApiError(result.response.status, body);
  }
  return result.data as T;
}

async function generatedEnvelope<T>(
  request: Promise<GeneratedResult<{ readonly data: T }>>,
): Promise<T> {
  return (await generatedResult(request)).data;
}

function generatedMutationHeaders(): Record<string, string> {
  const csrf = readCsrfToken();
  return csrf ? { 'x-csrf-token': csrf } : {};
}

function optionalString(value: object, key: string): string | undefined {
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

export function resolveApiMediaUrl(value: string): string {
  if (/^(?:blob:|data:|https?:\/\/)/i.test(value)) return value;
  if (!value.startsWith('/') || !/^https?:\/\//i.test(API_BASE)) return value;
  return new URL(value, API_BASE).toString();
}

function mapUser(value: SplitoApiSchemas['User']): UserProfile {
  const avatarUrl = optionalString(value, 'avatarUrl');
  return { ...value, ...(avatarUrl ? { avatarUrl: resolveApiMediaUrl(avatarUrl) } : {}) };
}

function mapGroup(value: SplitoApiSchemas['Group']): GroupSummary {
  const imageUrl = optionalString(value, 'imageUrl');
  return { ...value, ...(imageUrl ? { imageUrl: resolveApiMediaUrl(imageUrl) } : {}) };
}

function mapParticipant<T extends Participant>(value: T): T {
  const avatarUrl = optionalString(value, 'avatarUrl');
  return {
    ...value,
    ...(avatarUrl ? { avatarUrl: resolveApiMediaUrl(avatarUrl) } : {}),
  };
}

function mapGroupDetail(value: SplitoApiSchemas['GroupDetail']): GroupDetail {
  return {
    ...mapGroup(value),
    members: value.members.map((member) => mapParticipant({ ...member })),
    pendingInvitations: value.pendingInvitations.map((invitation) => ({ ...invitation })),
    simplificationEnabled: value.simplificationEnabled,
  };
}

function mapBalance(value: SplitoApiSchemas['BalanceLine']): BalanceLine {
  return { ...value };
}

function mapExpense(value: SplitoApiSchemas['Expense']): ExpenseSummary {
  return {
    ...value,
    canEdit: value.canEdit,
    createdBy: value.createdBy ? mapParticipant({ ...value.createdBy }) : undefined,
    payers: value.payers.map((payer) => mapParticipant({ ...payer })),
    allocations: value.allocations.map((allocation) => mapParticipant({ ...allocation })),
  };
}

function mapSplitPreview(value: SplitoApiSchemas['SplitPreview']): SplitPreview {
  return { ...value, allocations: value.allocations.map((allocation) => ({ ...allocation })) };
}

function readCsrfToken(): string | undefined {
  const item = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('SPLITO_CSRF='));
  return item ? decodeURIComponent(item.slice('SPLITO_CSRF='.length)) : undefined;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  idempotencyKey?: string;
  resourceVersion?: string | number;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
  if (options.resourceVersion !== undefined)
    headers.set('If-Match', String(options.resourceVersion));

  const method = (options.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = readCsrfToken();
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`, {
      ...options,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'include',
      headers,
    });
  } catch {
    throw new ApiError(0, { error: { code: 'NETWORK_ERROR' } });
  }

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? ((await response.json()) as ApiErrorBody & { data?: T })
    : undefined;

  if (!response.ok) {
    throw new ApiError(response.status, payload ?? {});
  }

  if (response.status === 204) return undefined as T;
  return (payload && 'data' in payload ? payload.data : payload) as T;
}

async function apiUpload<T>(
  path: string,
  file: File,
  {
    idempotencyKey,
    method = 'POST',
  }: {
    idempotencyKey?: string;
    method?: 'POST' | 'PUT';
  },
): Promise<T> {
  const body = new FormData();
  body.set('file', file, file.name);
  const headers = new Headers({ Accept: 'application/json' });
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
  const csrf = readCsrfToken();
  if (csrf) headers.set('X-CSRF-Token', csrf);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      body,
      credentials: 'include',
      headers,
      method,
    });
  } catch {
    throw new ApiError(0, { error: { code: 'NETWORK_ERROR' } });
  }
  const payload = response.headers.get('content-type')?.includes('application/json')
    ? ((await response.json()) as ApiErrorBody & { data?: T })
    : undefined;
  if (!response.ok) throw new ApiError(response.status, payload ?? {});
  return (payload && 'data' in payload ? payload.data : payload) as T;
}

function asPage<T>(value: T[] | CursorPage<T> | { results?: T[] }): CursorPage<T> {
  if (Array.isArray(value)) return { items: value };
  if (value && 'items' in value && Array.isArray(value.items)) return value;
  if (value && 'results' in value && Array.isArray(value.results)) return { items: value.results };
  return { items: [] };
}

function queryString(values: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value));
  });
  const result = search.toString();
  return result ? `?${result}` : '';
}

export const api = {
  currentUser: async () =>
    mapUser(await generatedEnvelope<SplitoApiSchemas['User']>(generatedApi.GET('/api/v1/me'))),
  requestOtp: (body: SplitoApiSchemas['RequestMobileOtpRequest']) =>
    generatedEnvelope<SplitoApiSchemas['MobileOtpChallenge']>(
      generatedApi.POST('/api/v1/auth/mobile/request-otp', { body }),
    ),
  verifyOtp: async (body: SplitoApiSchemas['VerifyMobileOtpRequest']) => {
    const result = await generatedEnvelope<SplitoApiSchemas['MobileOtpVerification']>(
      generatedApi.POST('/api/v1/auth/mobile/verify-otp', { body }),
    );
    return { ...result, user: mapUser(result.user) };
  },
  login: async (body: { email: string; password: string }) =>
    mapUser(
      await generatedEnvelope<SplitoApiSchemas['User']>(
        generatedApi.POST('/api/v1/auth/login', { body }),
      ),
    ),
  register: async (body: SplitoApiSchemas['RegisterRequest']) => {
    const result = await generatedEnvelope<SplitoApiSchemas['RegistrationResult']>(
      generatedApi.POST('/api/v1/auth/register', { body }),
    );
    return {
      verificationRequired: result.verificationRequired,
      message: 'Open the single-use verification link we sent before signing in.',
    };
  },
  requestPasswordReset: (body: { email: string }) =>
    apiRequest<{ accepted: boolean; message?: string }>('/auth/password-reset/request', {
      body,
      method: 'POST',
    }),
  resetPassword: (body: { token: string; password: string }) =>
    apiRequest<{ completed: boolean }>('/auth/password-reset/confirm', { body, method: 'POST' }),
  verifyEmail: async (token: string) => {
    await generatedResult(generatedApi.POST('/api/v1/auth/verify-email', { body: { token } }));
  },
  logout: async () => {
    await generatedResult(
      generatedApi.POST('/api/v1/auth/logout', { headers: generatedMutationHeaders() }),
    );
  },
  balances: async () =>
    asPage(
      (
        await generatedEnvelope<readonly SplitoApiSchemas['BalanceLine'][]>(
          generatedApi.GET('/api/v1/balances'),
        )
      ).map(mapBalance),
    ),
  groups: async () =>
    asPage(
      (
        await generatedEnvelope<readonly SplitoApiSchemas['Group'][]>(
          generatedApi.GET('/api/v1/groups'),
        )
      ).map(mapGroup),
    ),
  createGroup: async (body: SplitoApiSchemas['CreateGroupRequest']) =>
    mapGroup(
      await generatedEnvelope<SplitoApiSchemas['Group']>(
        generatedApi.POST('/api/v1/groups', {
          body,
          headers: generatedMutationHeaders(),
        }),
      ),
    ),
  group: async (groupId: string) =>
    mapGroupDetail(
      await generatedEnvelope<SplitoApiSchemas['GroupDetail']>(
        generatedApi.GET('/api/v1/groups/{groupId}', {
          params: { path: { groupId } },
        }),
      ),
    ),
  addGroupMember: async (groupId: string, mobileNumber: string) => {
    const result = await generatedEnvelope<
      | SplitoApiSchemas['RegisteredGroupMemberResult']
      | SplitoApiSchemas['GroupInvitationSentResult']
    >(
      generatedApi.POST('/api/v1/groups/{groupId}/members', {
        body: { mobileNumber },
        headers: generatedMutationHeaders(),
        params: { path: { groupId } },
      }),
    );
    return result.outcome === 'member_added'
      ? { ...result, member: mapParticipant(result.member) }
      : result;
  },
  previewGroupInvitation: (token: string) =>
    generatedEnvelope<SplitoApiSchemas['GroupInvitationPreview']>(
      generatedApi.POST('/api/v1/group-invitations/preview', { body: { token } }),
    ),
  acceptGroupInvitation: async (token: string) => {
    const result = await generatedEnvelope<SplitoApiSchemas['GroupInvitationAcceptance']>(
      generatedApi.POST('/api/v1/group-invitations/accept', {
        body: { token },
        headers: generatedMutationHeaders(),
      }),
    );
    return { ...result, member: mapParticipant(result.member) };
  },
  groupBalances: async (groupId: string) =>
    asPage(
      (
        await generatedEnvelope<readonly SplitoApiSchemas['BalanceLine'][]>(
          generatedApi.GET('/api/v1/groups/{groupId}/balances', {
            params: { path: { groupId } },
          }),
        )
      ).map(mapBalance),
    ),
  groupExpenses: async (groupId: string, cursor?: string) => {
    const page = await generatedEnvelope<SplitoApiSchemas['ExpensePage']>(
      generatedApi.GET('/api/v1/groups/{groupId}/expenses', {
        params: { path: { groupId }, query: { ...(cursor ? { cursor } : {}), limit: 30 } },
      }),
    );
    return {
      items: page.items.map(mapExpense),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  },
  expense: async (expenseId: string) =>
    mapExpense(
      await generatedEnvelope<SplitoApiSchemas['Expense']>(
        generatedApi.GET('/api/v1/expenses/{expenseId}', {
          params: { path: { expenseId } },
        }),
      ),
    ),
  splitPreview: async (body: unknown) =>
    mapSplitPreview(
      await generatedEnvelope<SplitoApiSchemas['SplitPreview']>(
        generatedApi.POST('/api/v1/expenses/split-preview', {
          body: body as SplitoApiSchemas['ExpenseMutationRequest'],
        }),
      ),
    ),
  createExpense: async (body: unknown, idempotencyKey: string) =>
    mapExpense(
      await generatedEnvelope<SplitoApiSchemas['Expense']>(
        generatedApi.POST('/api/v1/expenses', {
          body: body as SplitoApiSchemas['ExpenseMutationRequest'],
          headers: generatedMutationHeaders(),
          params: { header: { 'Idempotency-Key': idempotencyKey } },
        }),
      ),
    ),
  updateExpense: async (
    expenseId: string,
    body: unknown,
    resourceVersion: string | number,
    idempotencyKey: string,
  ) =>
    mapExpense(
      await generatedEnvelope<SplitoApiSchemas['Expense']>(
        generatedApi.PUT('/api/v1/expenses/{expenseId}', {
          body: body as SplitoApiSchemas['ExpenseMutationRequest'],
          headers: generatedMutationHeaders(),
          params: {
            header: {
              'Idempotency-Key': idempotencyKey,
              'If-Match': String(resourceVersion),
            },
            path: { expenseId },
          },
        }),
      ),
    ),
  uploadReceipt: (expenseId: string, file: File, idempotencyKey: string) =>
    apiUpload<{ id: string; status: string }>(
      `/expenses/${encodeURIComponent(expenseId)}/attachments`,
      file,
      { idempotencyKey },
    ),
  createSettlement: (body: unknown, idempotencyKey: string) =>
    generatedEnvelope<SplitoApiSchemas['SettlementCreated']>(
      generatedApi.POST('/api/v1/settlements', {
        body: body as SplitoApiSchemas['CreateSettlementRequest'],
        headers: generatedMutationHeaders(),
        params: { header: { 'Idempotency-Key': idempotencyKey } },
      }),
    ),
  settlementPreview: (body: unknown) =>
    generatedEnvelope<SplitoApiSchemas['SettlementPreview']>(
      generatedApi.POST('/api/v1/settlements/preview', {
        body: body as SplitoApiSchemas['SettlementPreviewRequest'],
      }),
    ),
  analytics: (period: string, groupId?: string) =>
    apiRequest<AnalyticsResponse>(`/analytics/spending${queryString({ period, groupId })}`),
  activity: async (cursor?: string) =>
    asPage(
      await apiRequest<ActivityItem[] | CursorPage<ActivityItem>>(
        `/activity${queryString({ cursor })}`,
      ),
    ),
  search: async (
    filters: {
      query: string;
      category?: string;
      currency?: string;
      dateFrom?: string;
      dateTo?: string;
      groupId?: string;
      participantId?: string;
      receipt?: string;
      minAmountMinor?: string;
      maxAmountMinor?: string;
    },
    cursor?: string,
  ) =>
    asPage(
      await apiRequest<ExpenseSummary[] | CursorPage<ExpenseSummary>>(
        `/search${queryString({ q: filters.query, ...filters, query: undefined, cursor })}`,
      ),
    ),
  recurring: async () =>
    asPage(await apiRequest<RecurringTemplate[] | CursorPage<RecurringTemplate>>('/recurrence')),
  receipts: async () =>
    asPage(await apiRequest<ReceiptRecord[] | CursorPage<ReceiptRecord>>('/receipts')),
  sessions: async () =>
    asPage(await apiRequest<SessionRecord[] | CursorPage<SessionRecord>>('/sessions')),
  revokeSession: (sessionId: string) =>
    apiRequest<void>(`/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),
  updatePreferences: async (body: Record<string, unknown>) =>
    mapUser(
      (await apiRequest<UserProfile>('/me/preferences', {
        body,
        method: 'PATCH',
      })) as SplitoApiSchemas['User'],
    ),
  uploadProfileImage: async (file: File) => {
    const result = await apiUpload<{ url: string; version: string }>('/me/avatar', file, {
      method: 'PUT',
    });
    return { ...result, url: resolveApiMediaUrl(result.url) };
  },
  removeProfileImage: () => apiRequest<void>('/me/avatar', { method: 'DELETE' }),
  uploadGroupImage: async (groupId: string, file: File) => {
    const result = await apiUpload<{ url: string; version: string }>(
      `/groups/${encodeURIComponent(groupId)}/image`,
      file,
      { method: 'PUT' },
    );
    return { ...result, url: resolveApiMediaUrl(result.url) };
  },
  removeGroupImage: (groupId: string) =>
    apiRequest<void>(`/groups/${encodeURIComponent(groupId)}/image`, { method: 'DELETE' }),
  requestDataExport: () =>
    apiRequest<{ exportId: string; status: string }>('/me/exports', {
      idempotencyKey: crypto.randomUUID(),
      method: 'POST',
    }),
  startAccountDeletion: (body: { confirmation: string }) =>
    apiRequest<{ workflowId: string; status: string }>('/me/deletion', {
      body,
      idempotencyKey: crypto.randomUUID(),
      method: 'POST',
    }),
};

export function friendlyApiError(error: unknown): string {
  if (error instanceof ApiError) {
    return safeApiErrorMessage(error.code, error.status);
  }
  return 'Something unexpected happened. Please try again.';
}

import { ApiError } from './api-error.js';

export function requireIdempotencyKey(value: string | string[] | undefined): string {
  const key = Array.isArray(value) ? undefined : value;
  if (!key || !/^[A-Za-z0-9._:-]{8,200}$/.test(key)) {
    throw new ApiError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Provide an Idempotency-Key header containing 8 to 200 safe characters.',
    );
  }
  return key;
}

export function requireResourceVersion(value: string | string[] | undefined): string {
  const header = Array.isArray(value) ? undefined : value?.trim();
  if (!header) {
    throw new ApiError(
      428,
      'RESOURCE_VERSION_REQUIRED',
      'Provide the current expense version in the If-Match header.',
    );
  }

  const match = /^(?:"([1-9][0-9]{0,18})"|([1-9][0-9]{0,18}))$/u.exec(header);
  const version = match?.[1] ?? match?.[2];
  if (!version) {
    throw new ApiError(
      400,
      'INVALID_RESOURCE_VERSION',
      'If-Match must contain one positive decimal resource version.',
    );
  }
  return version;
}

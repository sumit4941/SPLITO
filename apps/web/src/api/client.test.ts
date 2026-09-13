import { describe, expect, it } from 'vitest';
import { ApiError, friendlyApiError } from './client';

describe('friendlyApiError', () => {
  it('hides route, method, and request-id details from an unstructured route failure', () => {
    const error = new ApiError(404, {
      error: {
        message: 'Cannot GET /api/v1/friends Request ID: bc7b92db-eb59-449f-8cc1-0a01c0c042d3',
        requestId: 'bc7b92db-eb59-449f-8cc1-0a01c0c042d3',
      },
    });

    expect(friendlyApiError(error)).toBe('This information is not available.');
    expect(error.message).toBe('This information is not available.');
    expect(friendlyApiError(error)).not.toMatch(/GET|\/api\/|404|request\s*id|bc7b92db|not found/i);
  });

  it('uses curated copy for an allowlisted code and ignores the server message', () => {
    const error = new ApiError(400, {
      error: {
        code: 'INVALID_OR_EXPIRED_OTP',
        message: 'OTP query failed at /api/v1/auth/mobile/verify\nDatabase stack trace',
        requestId: 'private-correlation-value',
      },
    });

    expect(friendlyApiError(error)).toBe('That verification code is incorrect or has expired.');
    expect(friendlyApiError(error)).not.toMatch(/api|database|stack|request|private/i);
  });

  it.each([
    {
      error: new ApiError(500, {
        error: {
          code: 'INTERNAL_ERROR',
          message: '<!doctype html><html><body>upstream failed</body></html>',
        },
      }),
      expected: 'Something went wrong on our side. Please try again.',
    },
    {
      error: new ApiError(418, {
        error: { code: '/API/V1/PRIVATE', message: 'Cannot POST /api/v1/private' },
      }),
      expected: 'We could not complete that action. Please try again.',
    },
    {
      error: new Error('Cannot DELETE /api/v1/users/123\n    at /srv/app/controller.js:42'),
      expected: 'Something unexpected happened. Please try again.',
    },
    {
      error: '<script>alert("private")</script> Request ID: secret',
      expected: 'Something unexpected happened. Please try again.',
    },
  ])('does not return raw HTML, stack traces, or unknown error text', ({ error, expected }) => {
    const message = friendlyApiError(error);

    expect(message).toBe(expected);
    expect(message).not.toMatch(/<|>|\/api\/|DELETE|POST|request\s*id|stack|\/srv\//i);
  });

  it.each([
    [0, 'We could not connect. Check your internet connection and try again.'],
    [401, 'Please sign in to continue.'],
    [403, 'You do not have permission to do that.'],
    [409, 'This information changed. Refresh the page and try again.'],
    [429, 'Too many attempts. Wait a little and try again.'],
    [503, 'Something went wrong on our side. Please try again.'],
  ])('provides safe fallback copy for status %i', (status, expected) => {
    const error = new ApiError(status, {
      error: { code: `UNKNOWN_${status}`, message: `HTTP ${status} from /api/v1/private` },
    });

    expect(friendlyApiError(error)).toBe(expected);
    expect(friendlyApiError(error)).not.toContain(String(status));
  });
});

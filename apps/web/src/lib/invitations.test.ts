// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  captureGroupInvitationToken,
  clearGroupInvitationToken,
  invitationTokenFromHash,
  readGroupInvitationToken,
  safeInternalDestination,
} from './invitations';

const token = 'rC8n0lPc1jQpJ1F7h6v2mK3wZ9xB4sT5uV7yD8eF9gH';

describe('group invitation navigation', () => {
  beforeEach(() => {
    clearGroupInvitationToken();
    window.history.replaceState({}, '', '/');
  });

  it('captures a valid fragment token in tab-scoped storage and immediately scrubs the URL', () => {
    window.history.replaceState({}, '', `/join#invite=${token}`);

    expect(captureGroupInvitationToken()).toBe(token);
    expect(readGroupInvitationToken()).toBe(token);
    expect(window.location.pathname).toBe('/join');
    expect(window.location.hash).toBe('');
  });

  it('scrubs malformed invitation material without preserving it', () => {
    window.history.replaceState({}, '', '/join#invite=https%3A%2F%2Fevil.example');

    expect(captureGroupInvitationToken()).toBeUndefined();
    expect(readGroupInvitationToken()).toBeUndefined();
    expect(window.location.hash).toBe('');
  });

  it('accepts only same-origin internal redirect destinations', () => {
    expect(safeInternalDestination('/join?source=sms#invite=safe')).toBe(
      '/join?source=sms#invite=safe',
    );
    expect(safeInternalDestination('//evil.example/path')).toBe('/');
    expect(safeInternalDestination('/\\evil.example/path')).toBe('/');
    expect(safeInternalDestination('https://evil.example/path')).toBe('/');
    expect(safeInternalDestination(undefined)).toBe('/');
  });

  it('rejects short or punctuated invite tokens', () => {
    expect(invitationTokenFromHash('#invite=short')).toBeUndefined();
    expect(invitationTokenFromHash(`#invite=${token}.html`)).toBeUndefined();
  });
});

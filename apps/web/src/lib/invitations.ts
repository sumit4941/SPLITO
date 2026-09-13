const GROUP_INVITE_SESSION_KEY = 'splito.pending-group-invite';
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/u;

export function safeInternalDestination(value: unknown, fallback = '/'): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    /[\r\n\0]/u.test(value)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function invitationTokenFromHash(hash: string): string | undefined {
  const parameters = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const token = parameters.get('invite')?.trim();
  return token && INVITE_TOKEN_PATTERN.test(token) ? token : undefined;
}

export function captureGroupInvitationToken(): string | undefined {
  const parameters = new URLSearchParams(window.location.hash.slice(1));
  if (!parameters.has('invite')) return readGroupInvitationToken();

  const token = invitationTokenFromHash(window.location.hash);
  if (token) window.sessionStorage.setItem(GROUP_INVITE_SESSION_KEY, token);
  else window.sessionStorage.removeItem(GROUP_INVITE_SESSION_KEY);

  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}`,
  );
  return token;
}

export function readGroupInvitationToken(): string | undefined {
  const token = window.sessionStorage.getItem(GROUP_INVITE_SESSION_KEY)?.trim();
  return token && INVITE_TOKEN_PATTERN.test(token) ? token : undefined;
}

export function clearGroupInvitationToken(): void {
  window.sessionStorage.removeItem(GROUP_INVITE_SESSION_KEY);
}

export interface AuthenticatedUser {
  /** Public financial identity; group member IDs and expense participant IDs use this value. */
  readonly id: string;
  /** Account identity retained for authorization/audit writes, not as a financial participant key. */
  readonly userId: string;
  readonly participantId: string;
  readonly email?: string;
  readonly mobileNumber?: string;
  readonly displayName: string;
  readonly avatarUrl?: string;
  readonly locale: string;
  readonly timezone: string;
  readonly defaultCurrency: string;
  readonly theme: 'light' | 'dark' | 'system';
  readonly reducedMotion: boolean;
  readonly version: string;
}

export interface AuthContext {
  readonly sessionId: string;
  readonly user: AuthenticatedUser;
  readonly csrfHash: Buffer;
}

export interface NewSession {
  readonly auth: AuthContext;
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly expiresAt: Date;
}

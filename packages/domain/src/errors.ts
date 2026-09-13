export type DomainErrorDetails = Readonly<Record<string, unknown>>;

/** A stable, transport-safe error raised when a financial invariant is violated. */
export class DomainError extends Error {
  readonly code: string;
  readonly details: DomainErrorDetails | undefined;

  constructor(code: string, message: string, details?: DomainErrorDetails) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export function domainAssert(
  condition: unknown,
  code: string,
  message: string,
  details?: DomainErrorDetails,
): asserts condition {
  if (!condition) {
    throw new DomainError(code, message, details);
  }
}

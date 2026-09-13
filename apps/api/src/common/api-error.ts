import { HttpException } from '@nestjs/common';

export interface FieldError {
  readonly field: string;
  readonly message: string;
}

export class ApiError extends HttpException {
  readonly code: string;
  readonly fieldErrors: readonly FieldError[] | undefined;
  readonly responseHeaders: Readonly<Record<string, string>> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    fieldErrors?: readonly FieldError[],
    responseHeaders?: Readonly<Record<string, string>>,
  ) {
    super(message, status);
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.responseHeaders = responseHeaders;
  }
}

import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { DomainError } from '@splito/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError, type FieldError } from './api-error.js';

interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly fieldErrors?: readonly FieldError[];
    readonly requestId: string;
  };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred.';
    let fieldErrors: readonly FieldError[] | undefined;

    if (exception instanceof ApiError) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      fieldErrors = exception.fieldErrors;
      for (const [name, value] of Object.entries(exception.responseHeaders ?? {})) {
        void reply.header(name, value);
      }
    } else if (exception instanceof DomainError) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = `HTTP_${status}`;
      const response = exception.getResponse();
      message =
        typeof response === 'string'
          ? response
          : typeof response === 'object' && response !== null && 'message' in response
            ? String(response.message)
            : exception.message;
    }

    if (status >= 500) {
      request.log.error({ err: exception, requestId: request.id }, 'API request failed');
    }

    const body: ErrorEnvelope = {
      error: {
        code,
        message,
        ...(fieldErrors ? { fieldErrors } : {}),
        requestId: request.id,
      },
    };
    void reply.status(status).send(body);
  }
}

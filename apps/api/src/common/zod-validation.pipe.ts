import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ApiError } from './api-error.js';

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const fieldErrors = result.error.issues.map((issue) => ({
      field: issue.path.length > 0 ? issue.path.join('.') : '$body',
      message: issue.message,
    }));
    throw new ApiError(
      400,
      'VALIDATION_FAILED',
      'The request contains invalid fields.',
      fieldErrors,
    );
  }
}

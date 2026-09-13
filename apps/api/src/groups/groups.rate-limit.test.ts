import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { GroupsController } from './groups.controller.js';

describe('group member delivery route limits', () => {
  it('applies a strict per-IP minute limit to the SMS-triggering endpoint', () => {
    const metadata = Reflect.getMetadata(
      '__fastify_route_config__',
      GroupsController.prototype.addMember,
    ) as unknown;

    expect(metadata).toEqual({ rateLimit: { max: 10, timeWindow: '1 minute' } });
  });
});

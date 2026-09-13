import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvironment } from '@splito/config';
import { afterEach, describe, expect, it } from 'vitest';
import { PrivateMediaStorage } from './private-media.storage.js';

const mediaId = '11111111-1111-4111-8111-111111111111';
const roots: string[] = [];

async function storage(environment: 'development' | 'production' = 'development') {
  const root = await mkdtemp(join(tmpdir(), 'splito-media-'));
  roots.push(root);
  const developmentConfig = loadEnvironment({ ATTACHMENT_STORAGE_PATH: root });
  const adapter = new PrivateMediaStorage(
    environment === 'production'
      ? ({ ...developmentConfig, NODE_ENV: 'production' } as const)
      : developmentConfig,
  );
  await adapter.onModuleInit();
  return { adapter, root };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('private filesystem media storage', () => {
  it('stores generated keys privately, reads them, and deletes idempotently', async () => {
    const { adapter, root } = await storage();
    const bytes = Buffer.from('sanitized webp bytes');
    const key = await adapter.store(mediaId, 'USER_AVATAR', bytes);

    expect(key).toBe(`user-avatar/11/${mediaId}.webp`);
    await expect(adapter.read(key)).resolves.toEqual(bytes);
    await expect(readFile(join(root, key))).resolves.toEqual(bytes);
    await adapter.delete(key);
    await expect(adapter.read(key)).resolves.toBeUndefined();
    await expect(adapter.delete(key)).resolves.toBeUndefined();
  });

  it('uses exclusive final creation and never overwrites an existing media object', async () => {
    const { adapter } = await storage();
    const key = await adapter.store(mediaId, 'GROUP_IMAGE', Buffer.from('first'));
    await expect(
      adapter.store(mediaId, 'GROUP_IMAGE', Buffer.from('second')),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(adapter.read(key)).resolves.toEqual(Buffer.from('first'));
  });

  it('rejects unsafe identifiers and storage keys before filesystem access', async () => {
    const { adapter } = await storage();
    await expect(adapter.store('../../outside', 'USER_AVATAR', Buffer.from('x'))).rejects.toThrow(
      'Invalid private-media identifier',
    );
    await expect(adapter.read('../outside.webp')).rejects.toThrow(
      'Unsafe private-media storage key',
    );
  });

  it('does not create or use filesystem media storage in production', async () => {
    const { adapter, root } = await storage('production');
    await expect(stat(join(root, '.quarantine'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(() => adapter.assertAvailable()).toThrow('disabled in production');
    await expect(adapter.store(mediaId, 'USER_AVATAR', Buffer.from('x'))).rejects.toThrow(
      'disabled in production',
    );
    await expect(adapter.read(`user-avatar/11/${mediaId}.webp`)).rejects.toThrow(
      'disabled in production',
    );
  });
});

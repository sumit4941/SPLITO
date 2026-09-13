import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Environment } from '@splito/config';
import { APP_CONFIG } from '../config/app-config.js';
import type { MediaKind } from './media.types.js';

const SAFE_KEY = /^(?:user-avatar|group-image)\/[0-9a-f]{2}\/[0-9a-f-]{36}\.webp$/u;
const SAFE_MEDIA_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;

@Injectable()
export class PrivateMediaStorage implements OnModuleInit {
  readonly #root: string;
  readonly #quarantine: string;
  readonly #production: boolean;

  constructor(@Inject(APP_CONFIG) config: Environment) {
    const launchDirectory = process.env.INIT_CWD?.trim() || process.cwd();
    this.#root = resolve(launchDirectory, config.ATTACHMENT_STORAGE_PATH);
    this.#quarantine = resolve(this.#root, '.quarantine');
    this.#production = config.NODE_ENV === 'production';
  }

  async onModuleInit(): Promise<void> {
    if (this.#production) return;
    await mkdir(this.#quarantine, { mode: 0o700, recursive: true });
  }

  assertAvailable(): void {
    this.#requireDevelopmentAdapter();
  }

  async store(mediaId: string, kind: MediaKind, bytes: Buffer): Promise<string> {
    this.#requireDevelopmentAdapter();
    if (!SAFE_MEDIA_ID.test(mediaId)) throw new Error('Invalid private-media identifier');
    const directory = kind === 'USER_AVATAR' ? 'user-avatar' : 'group-image';
    const storageKey = `${directory}/${mediaId.slice(0, 2)}/${mediaId}.webp`;
    const target = this.#pathFor(storageKey);
    const temporary = this.#pathFor(`.quarantine/${randomUUID()}.upload`);
    await mkdir(dirname(target), { mode: 0o700, recursive: true });
    try {
      await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
      await link(temporary, target);
      await rm(temporary, { force: true }).catch(() => undefined);
      return storageKey;
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async read(storageKey: string): Promise<Buffer | undefined> {
    this.#requireDevelopmentAdapter();
    try {
      return await readFile(this.#pathForExistingKey(storageKey));
    } catch (error) {
      if (this.#isMissing(error)) return undefined;
      throw error;
    }
  }

  async delete(storageKey: string): Promise<void> {
    this.#requireDevelopmentAdapter();
    try {
      await rm(this.#pathForExistingKey(storageKey), { force: true });
    } catch (error) {
      if (!this.#isMissing(error)) throw error;
    }
  }

  #pathForExistingKey(storageKey: string): string {
    if (!SAFE_KEY.test(storageKey)) throw new Error('Unsafe private-media storage key');
    return this.#pathFor(storageKey);
  }

  #pathFor(storageKey: string): string {
    const path = resolve(this.#root, storageKey);
    const child = relative(this.#root, path);
    if (!child || child.startsWith('..') || isAbsolute(child)) {
      throw new Error('Private-media path escaped its configured root');
    }
    return path;
  }

  #isMissing(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    );
  }

  #requireDevelopmentAdapter(): void {
    if (this.#production) {
      throw new Error('The development filesystem media adapter is disabled in production');
    }
  }
}

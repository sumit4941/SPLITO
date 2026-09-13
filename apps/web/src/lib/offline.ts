import Dexie, { type EntityTable } from 'dexie';
import { ApiError, apiRequest, friendlyApiError } from '../api/client';

export type OfflineState = 'draft' | 'pending' | 'syncing' | 'failed' | 'conflicted' | 'synced';

export interface ExpenseDraft {
  id: string;
  accountId: string;
  payload: Record<string, unknown>;
  state: 'draft';
  createdAt: string;
  updatedAt: string;
}

export interface QueuedMutation {
  id: string;
  accountId: string;
  kind: 'expense.create' | 'expense.update';
  endpoint: string;
  method: 'POST' | 'PATCH';
  payload: Record<string, unknown>;
  idempotencyKey: string;
  resourceVersion?: string | number;
  dependsOn: string[];
  state: Exclude<OfflineState, 'draft'>;
  attemptCount: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

class SplitoOfflineDatabase extends Dexie {
  drafts!: EntityTable<ExpenseDraft, 'id'>;
  queue!: EntityTable<QueuedMutation, 'id'>;

  constructor() {
    super('splito-offline-v1');
    this.version(1).stores({
      drafts: '&id, accountId, updatedAt',
      queue: '&id, accountId, state, createdAt, *dependsOn',
    });
  }
}

export const offlineDb = new SplitoOfflineDatabase();
const OFFLINE_EVENT = 'splito:offline-change';

function announceChange() {
  window.dispatchEvent(new CustomEvent(OFFLINE_EVENT));
}

export async function saveExpenseDraft(
  accountId: string,
  payload: Record<string, unknown>,
  existingId?: string,
): Promise<ExpenseDraft> {
  const now = new Date().toISOString();
  const draft: ExpenseDraft = {
    id: existingId ?? crypto.randomUUID(),
    accountId,
    payload,
    state: 'draft',
    createdAt: now,
    updatedAt: now,
  };
  const previous = existingId ? await offlineDb.drafts.get(existingId) : undefined;
  if (previous) draft.createdAt = previous.createdAt;
  await offlineDb.drafts.put(draft);
  announceChange();
  return draft;
}

export async function deleteExpenseDraft(id: string) {
  await offlineDb.drafts.delete(id);
  announceChange();
}

export async function queueExpenseMutation(
  accountId: string,
  payload: Record<string, unknown>,
  options: {
    dependsOn?: string[];
    endpoint?: string;
    kind?: QueuedMutation['kind'];
    method?: QueuedMutation['method'];
    resourceVersion?: string | number;
  } = {},
): Promise<QueuedMutation> {
  const now = new Date().toISOString();
  const mutation: QueuedMutation = {
    id: crypto.randomUUID(),
    accountId,
    kind: options.kind ?? 'expense.create',
    endpoint: options.endpoint ?? '/expenses',
    method: options.method ?? 'POST',
    payload,
    idempotencyKey: crypto.randomUUID(),
    resourceVersion: options.resourceVersion,
    dependsOn: options.dependsOn ?? [],
    state: 'pending',
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await offlineDb.queue.add(mutation);
  announceChange();
  return mutation;
}

export async function getOfflineItems(accountId: string) {
  const [drafts, queue] = await Promise.all([
    offlineDb.drafts.where('accountId').equals(accountId).reverse().sortBy('updatedAt'),
    offlineDb.queue.where('accountId').equals(accountId).sortBy('createdAt'),
  ]);
  return { drafts: drafts.reverse(), queue };
}

export async function retryQueuedMutation(id: string) {
  await offlineDb.queue.update(id, {
    state: 'pending',
    error: undefined,
    updatedAt: new Date().toISOString(),
  });
  announceChange();
}

export async function discardQueuedMutation(id: string) {
  await offlineDb.queue.delete(id);
  announceChange();
}

export async function clearOfflineAccount(accountId: string) {
  await offlineDb.transaction('rw', offlineDb.drafts, offlineDb.queue, async () => {
    await offlineDb.drafts.where('accountId').equals(accountId).delete();
    await offlineDb.queue.where('accountId').equals(accountId).delete();
  });
  announceChange();
}

export async function syncAccountQueue(accountId: string): Promise<void> {
  if (!navigator.onLine) return;
  const items = await offlineDb.queue.where('accountId').equals(accountId).sortBy('createdAt');
  const complete = new Set(items.filter((item) => item.state === 'synced').map((item) => item.id));
  const candidates = items.filter((item) => item.state === 'pending');
  let progress = true;

  while (candidates.length > 0 && progress) {
    progress = false;
    for (let index = 0; index < candidates.length; index += 1) {
      const item = candidates[index];
      if (!item.dependsOn.every((dependency) => complete.has(dependency))) continue;
      candidates.splice(index, 1);
      index -= 1;
      progress = true;
      await offlineDb.queue.update(item.id, {
        attemptCount: item.attemptCount + 1,
        state: 'syncing',
        updatedAt: new Date().toISOString(),
      });
      announceChange();
      try {
        await apiRequest(item.endpoint, {
          body: item.payload,
          idempotencyKey: item.idempotencyKey,
          method: item.method,
          resourceVersion: item.resourceVersion,
        });
        complete.add(item.id);
        await offlineDb.queue.update(item.id, {
          error: undefined,
          state: 'synced',
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        const conflict = error instanceof ApiError && [409, 412].includes(error.status);
        const attempts = item.attemptCount + 1;
        await offlineDb.queue.update(item.id, {
          error: friendlyApiError(error),
          state: conflict ? 'conflicted' : attempts < 3 ? 'pending' : 'failed',
          updatedAt: new Date().toISOString(),
        });
      }
      announceChange();
    }
  }
}

export function subscribeToOfflineChanges(listener: () => void) {
  window.addEventListener(OFFLINE_EVENT, listener);
  return () => window.removeEventListener(OFFLINE_EVENT, listener);
}

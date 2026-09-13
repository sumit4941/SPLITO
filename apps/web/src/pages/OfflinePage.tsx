import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  ErrorState,
  Modal,
  StatusBadge,
} from '@splito/ui';
import {
  AlertTriangle,
  Check,
  CloudOff,
  FileEdit,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Wifi,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { PageIntro } from '../components/PageElements';
import {
  clearOfflineAccount,
  deleteExpenseDraft,
  discardQueuedMutation,
  getOfflineItems,
  retryQueuedMutation,
  subscribeToOfflineChanges,
  syncAccountQueue,
  type ExpenseDraft,
  type QueuedMutation,
} from '../lib/offline';

function draftDescription(draft: ExpenseDraft) {
  const form = draft.payload.form;
  if (
    typeof form === 'object' &&
    form &&
    'description' in form &&
    typeof form.description === 'string'
  )
    return form.description || 'Untitled expense';
  return 'Untitled expense';
}

const statusMeta = {
  pending: { icon: CloudOff, label: 'Pending', tone: 'warning' },
  syncing: { icon: LoaderCircle, label: 'Syncing', tone: 'info' },
  failed: { icon: AlertTriangle, label: 'Failed', tone: 'negative' },
  conflicted: { icon: ShieldAlert, label: 'Conflict', tone: 'negative' },
  synced: { icon: Check, label: 'Synced', tone: 'positive' },
} as const;

export function OfflinePage() {
  const location = useLocation();
  const user = useQuery({ queryKey: ['me'], queryFn: api.currentUser, retry: false });
  const accountId = user.data?.id ?? 'anonymous';
  const [drafts, setDrafts] = useState<ExpenseDraft[]>([]);
  const [queue, setQueue] = useState<QueuedMutation[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const items = await getOfflineItems(accountId);
      setDrafts(items.drafts);
      setQueue(items.queue);
      setError(undefined);
    } catch {
      setError('Device storage could not be read. Reload the page and try again.');
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void refresh();
    return subscribeToOfflineChanges(() => void refresh());
  }, [refresh]);

  const syncNow = async () => {
    setSyncing(true);
    try {
      await syncAccountQueue(accountId);
      await refresh();
    } finally {
      setSyncing(false);
    }
  };

  const clear = async () => {
    await clearOfflineAccount(accountId);
    setClearOpen(false);
    await refresh();
  };

  return (
    <div className="page-stack">
      <PageIntro
        actions={
          <Button
            busy={syncing}
            disabled={!navigator.onLine}
            icon={RefreshCw}
            onClick={() => void syncNow()}
            variant="secondary"
          >
            Sync now
          </Button>
        }
        eyebrow="This device only"
        title="Offline drafts and changes"
        description="Local work is account-partitioned. It never replaces authoritative server balances before a successful sync."
      />
      {(location.state as { queued?: boolean } | null)?.queued && (
        <div className="saved-callout" role="status">
          <Check aria-hidden="true" />
          Expense queued. It will be reauthorized when this app reconnects.
        </div>
      )}
      {!navigator.onLine && (
        <div className="offline-callout">
          <CloudOff aria-hidden="true" />
          <span>
            <strong>You are offline</strong>
            <small>SPLITO will retry while the app is open when connectivity returns.</small>
          </span>
        </div>
      )}
      {error && <ErrorState description={error} title="Offline storage unavailable" />}

      <div className="offline-summary">
        <Card>
          <CardContent>
            <span className="offline-summary__icon">
              <FileEdit aria-hidden="true" />
            </span>
            <span>
              <strong>{drafts.length}</strong>
              <small>local drafts</small>
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <span className="offline-summary__icon offline-summary__icon--amber">
              <CloudOff aria-hidden="true" />
            </span>
            <span>
              <strong>{queue.filter((item) => item.state === 'pending').length}</strong>
              <small>waiting to sync</small>
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <span className="offline-summary__icon offline-summary__icon--coral">
              <ShieldAlert aria-hidden="true" />
            </span>
            <span>
              <strong>
                {
                  queue.filter((item) => item.state === 'conflicted' || item.state === 'failed')
                    .length
                }
              </strong>
              <small>need attention</small>
            </span>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <span className="eyebrow">Autosaved</span>
            <h2>Expense drafts</h2>
          </div>
          <StatusBadge tone="neutral">Not authoritative</StatusBadge>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="inline-empty">
              <LoaderCircle className="ui-spin" />
              <p>Reading encrypted browser storage context…</p>
            </div>
          ) : drafts.length === 0 ? (
            <EmptyState
              action={
                <Button asChild size="sm">
                  <Link to="/expenses/new">Start an expense</Link>
                </Button>
              }
              description="Drafts you edit on this device will appear here."
              icon={FileEdit}
              title="No offline drafts"
            />
          ) : (
            <div className="offline-list">
              {drafts.map((draft) => (
                <div className="offline-row" key={draft.id}>
                  <span className="offline-row__icon">
                    <FileEdit aria-hidden="true" />
                  </span>
                  <span>
                    <strong>{draftDescription(draft)}</strong>
                    <small>
                      Updated{' '}
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(draft.updatedAt))}
                    </small>
                  </span>
                  <StatusBadge>Draft</StatusBadge>
                  <Button
                    aria-label={`Delete draft ${draftDescription(draft)}`}
                    onClick={() => void deleteExpenseDraft(draft.id)}
                    size="icon"
                    variant="ghost"
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <span className="eyebrow">Foreground sync queue</span>
            <h2>Queued changes</h2>
          </div>
          <StatusBadge tone={navigator.onLine ? 'positive' : 'warning'}>
            {navigator.onLine ? (
              <>
                <Wifi aria-hidden="true" size={12} />
                Connected
              </>
            ) : (
              <>
                <CloudOff aria-hidden="true" size={12} />
                Disconnected
              </>
            )}
          </StatusBadge>
        </CardHeader>
        <CardContent>
          {queue.length === 0 ? (
            <EmptyState
              description="Supported expense changes submitted offline will appear here."
              icon={Check}
              title="The queue is clear"
            />
          ) : (
            <div className="offline-list">
              {queue.map((item) => {
                const meta = statusMeta[item.state];
                const Icon = meta.icon;
                return (
                  <div className={`offline-row offline-row--${item.state}`} key={item.id}>
                    <span className="offline-row__icon">
                      <Icon
                        aria-hidden="true"
                        className={item.state === 'syncing' ? 'ui-spin' : ''}
                      />
                    </span>
                    <span>
                      <strong>
                        {item.kind === 'expense.create' ? 'Create expense' : 'Update expense'}
                      </strong>
                      <small>
                        {item.state === 'conflicted'
                          ? 'This change conflicts with newer information and was not applied.'
                          : item.state === 'failed'
                            ? 'This change could not be completed. Try again.'
                            : `Queued ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.createdAt))}`}
                      </small>
                      {item.state === 'conflicted' && (
                        <em>
                          The server has a newer or incompatible revision. No overwrite occurred.
                        </em>
                      )}
                    </span>
                    <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                    {(item.state === 'failed' || item.state === 'conflicted') && (
                      <Button
                        aria-label="Retry queued change"
                        onClick={async () => {
                          await retryQueuedMutation(item.id);
                          await syncNow();
                        }}
                        size="icon"
                        variant="ghost"
                      >
                        <RotateCcw aria-hidden="true" />
                      </Button>
                    )}
                    <Button
                      aria-label="Discard queued change"
                      onClick={() => void discardQueuedMutation(item.id)}
                      size="icon"
                      variant="ghost"
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {(drafts.length > 0 || queue.length > 0) && (
        <div className="offline-danger">
          <div>
            <strong>Clear this account's device data</strong>
            <p>This removes local drafts and queued changes. Server-confirmed data is untouched.</p>
          </div>
          <Button icon={Trash2} onClick={() => setClearOpen(true)} variant="danger">
            Clear local data
          </Button>
        </div>
      )}
      <Modal
        description="This cannot be undone and may discard unsynchronized financial changes."
        onOpenChange={setClearOpen}
        open={clearOpen}
        title="Clear local SPLITO data?"
      >
        <div className="form-actions">
          <Button onClick={() => setClearOpen(false)} variant="ghost">
            Keep data
          </Button>
          <Button onClick={() => void clear()} variant="danger">
            Clear this account's data
          </Button>
        </div>
      </Modal>
    </div>
  );
}

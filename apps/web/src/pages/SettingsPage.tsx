import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  SelectField,
  StatusBadge,
} from '@splito/ui';
import {
  Camera,
  Check,
  Download,
  KeyRound,
  Laptop,
  LockKeyhole,
  MonitorSmartphone,
  MoonStar,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { api, friendlyApiError } from '../api/client';
import { ApiErrorPanel, PageSkeleton } from '../components/ApiStates';
import { ImageUploadDialog } from '../components/ImageUploadDialog';
import { Avatar, PageIntro } from '../components/PageElements';
import { supportedCurrencies } from '../lib/money';
import { useTheme, type ThemePreference } from '../providers/ThemeProvider';
import type { SessionRecord, UserProfile } from '../types';

const preferencesSchema = z.object({
  defaultCurrency: z.string().length(3),
  locale: z.string().min(2).max(20),
  timezone: z.string().min(1).max(80),
  emailNotifications: z.boolean(),
  balanceReminders: z.boolean(),
});

type PreferencesValues = z.infer<typeof preferencesSchema>;

function ThemeChoice({
  icon: Icon,
  label,
  selected,
  value,
  onSelect,
}: {
  icon: typeof Sun;
  label: string;
  selected: boolean;
  value: ThemePreference;
  onSelect: (value: ThemePreference) => void;
}) {
  return (
    <button
      aria-pressed={selected}
      className="theme-choice"
      onClick={() => onSelect(value)}
      type="button"
    >
      <Icon aria-hidden="true" />
      <span>
        <strong>{label}</strong>
        <small>{value === 'system' ? 'Follow this device' : `${label} surfaces`}</small>
      </span>
      {selected && <Check aria-hidden="true" />}
    </button>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { preference, reducedMotion, setPreference, setReducedMotion } = useTheme();
  const user = useQuery({ queryKey: ['me'], queryFn: api.currentUser, retry: false });
  const form = useForm<PreferencesValues>({
    resolver: zodResolver(preferencesSchema),
    defaultValues: {
      balanceReminders: true,
      defaultCurrency: 'INR',
      emailNotifications: true,
      locale: 'en-IN',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [profileImageOpen, setProfileImageOpen] = useState(false);

  useEffect(() => {
    if (!user.data) return;
    form.reset({
      balanceReminders: user.data.preferences?.balanceReminders ?? true,
      defaultCurrency: user.data.defaultCurrency ?? 'INR',
      emailNotifications: user.data.preferences?.emailNotifications ?? true,
      locale: user.data.locale ?? 'en-IN',
      timezone: user.data.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    if (user.data.theme) setPreference(user.data.theme);
    const serverReducedMotion = user.data.reducedMotion ?? user.data.preferences?.reducedMotion;
    if (serverReducedMotion !== undefined) setReducedMotion(serverReducedMotion);
  }, [form, setPreference, setReducedMotion, user.data]);

  const update = useMutation({
    mutationFn: (values: PreferencesValues) =>
      api.updatePreferences({ ...values, reducedMotion, theme: preference }),
    async onSuccess(profile) {
      queryClient.setQueryData(['me'], profile);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const setProfileImage = (avatarUrl?: string) => {
    queryClient.setQueryData<UserProfile>(['me'], (current) => {
      if (!current) return current;
      const profile = { ...current };
      delete profile.avatarUrl;
      return avatarUrl ? { ...profile, avatarUrl } : profile;
    });
  };
  const uploadProfileImage = useMutation({
    mutationFn: api.uploadProfileImage,
    async onSuccess(result) {
      setProfileImage(result.url);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const removeProfileImage = useMutation({
    mutationFn: api.removeProfileImage,
    async onSuccess() {
      setProfileImage();
      await queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const exportData = useMutation({ mutationFn: api.requestDataExport });
  const deleteAccount = useMutation({
    mutationFn: () => api.startAccountDeletion({ confirmation: deleteConfirmation }),
    onSuccess: () => setDeleteOpen(false),
  });

  if (user.isLoading) return <PageSkeleton cards={4} />;
  if (user.error) return <ApiErrorPanel error={user.error} onRetry={() => void user.refetch()} />;

  return (
    <div className="page-stack settings-page">
      <PageIntro
        eyebrow="Account preferences"
        title="Make SPLITO feel like yours"
        description="Theme is cached locally to avoid a flash, then reconciled with your account preference."
      />
      <form
        className="settings-grid"
        onSubmit={form.handleSubmit((values) => update.mutate(values))}
      >
        <Card className="settings-profile">
          <CardHeader>
            <div>
              <span className="eyebrow">Profile</span>
              <h2>{user.data?.displayName}</h2>
              <p>{user.data?.email ?? user.data?.mobileNumber ?? 'Verified account'}</p>
            </div>
            <div className="settings-profile__picture">
              <Avatar
                participant={{
                  displayName: user.data?.displayName ?? '?',
                  ...(user.data?.avatarUrl ? { avatarUrl: user.data.avatarUrl } : {}),
                }}
                size="xl"
              />
              <Button
                icon={Camera}
                onClick={() => setProfileImageOpen(true)}
                size="sm"
                type="button"
                variant="secondary"
              >
                {user.data?.avatarUrl ? 'Change picture' : 'Add picture'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="form-stack">
            <div className="form-grid form-grid--three">
              <SelectField label="Default currency" {...form.register('defaultCurrency')}>
                {supportedCurrencies.map((currency) => (
                  <option key={currency}>{currency}</option>
                ))}
              </SelectField>
              <Field label="Locale" {...form.register('locale')} />
              <Field label="Timezone" {...form.register('timezone')} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <span className="eyebrow">Appearance</span>
              <h2>Theme and motion</h2>
            </div>
          </CardHeader>
          <CardContent>
            <div className="theme-grid">
              <ThemeChoice
                icon={Sun}
                label="Light"
                onSelect={setPreference}
                selected={preference === 'light'}
                value="light"
              />
              <ThemeChoice
                icon={MoonStar}
                label="Dark"
                onSelect={setPreference}
                selected={preference === 'dark'}
                value="dark"
              />
              <ThemeChoice
                icon={MonitorSmartphone}
                label="System"
                onSelect={setPreference}
                selected={preference === 'system'}
                value="system"
              />
            </div>
            <label className="preference-toggle">
              <span>
                <strong>Reduce animation</strong>
                <small>Use near-instant transitions and stop decorative movement.</small>
              </span>
              <input
                checked={reducedMotion}
                onChange={(event) => setReducedMotion(event.target.checked)}
                role="switch"
                type="checkbox"
              />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <span className="eyebrow">Notifications</span>
              <h2>Useful, not noisy</h2>
            </div>
          </CardHeader>
          <CardContent className="toggle-stack">
            <label className="preference-toggle">
              <span>
                <strong>Email notifications</strong>
                <small>Financial changes and invitations affecting you.</small>
              </span>
              <input role="switch" type="checkbox" {...form.register('emailNotifications')} />
            </label>
            <label className="preference-toggle">
              <span>
                <strong>Balance reminders</strong>
                <small>Occasional reminders when a balance stays outstanding.</small>
              </span>
              <input role="switch" type="checkbox" {...form.register('balanceReminders')} />
            </label>
          </CardContent>
        </Card>

        {update.error && (
          <ErrorState description={friendlyApiError(update.error)} title="Preferences not saved" />
        )}
        {update.isSuccess && (
          <div className="saved-callout" role="status">
            <Check aria-hidden="true" />
            Preferences saved to your account.
          </div>
        )}
        <div className="form-actions">
          <Button busy={update.isPending} size="lg" type="submit">
            Save preferences
          </Button>
        </div>
      </form>

      <ImageUploadDialog
        currentUrl={user.data?.avatarUrl}
        displayName={user.data?.displayName ?? 'Your profile'}
        kind="profile"
        onOpenChange={setProfileImageOpen}
        onRemove={async () => {
          await removeProfileImage.mutateAsync();
        }}
        onUpload={async (file) => {
          await uploadProfileImage.mutateAsync(file);
        }}
        open={profileImageOpen}
      />

      <div className="settings-grid settings-grid--secondary">
        <Card>
          <CardHeader>
            <div>
              <span className="eyebrow">Security</span>
              <h2>Sessions and sign-in</h2>
            </div>
            <ShieldCheck aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <p className="muted">
              Review signed-in devices, revoke sessions, and manage stronger sign-in methods.
            </p>
            <Button asChild variant="secondary">
              <Link to="/settings/security">Open security</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <span className="eyebrow">Your data</span>
              <h2>Export</h2>
            </div>
            <Download aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <p className="muted">
              Request a private, expiring download. Large exports are prepared asynchronously.
            </p>
            {exportData.error && (
              <ErrorState
                description={friendlyApiError(exportData.error)}
                title="Export not started"
              />
            )}
            {exportData.data ? (
              <StatusBadge tone="positive">Export {exportData.data.status}</StatusBadge>
            ) : (
              <Button
                busy={exportData.isPending}
                onClick={() => exportData.mutate()}
                variant="secondary"
              >
                Request data export
              </Button>
            )}
          </CardContent>
        </Card>
        <Card className="danger-card">
          <CardHeader>
            <div>
              <span className="eyebrow">Account lifecycle</span>
              <h2>Delete account</h2>
            </div>
            <Trash2 aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <p>
              Identity data can be removed or anonymized while necessary shared financial history is
              preserved for other participants.
            </p>
            <Button onClick={() => setDeleteOpen(true)} variant="danger">
              Start deletion workflow
            </Button>
          </CardContent>
        </Card>
      </div>

      <Modal
        description="This starts a reviewable account-deletion workflow; it does not silently destroy shared ledger history."
        onOpenChange={setDeleteOpen}
        open={deleteOpen}
        title="Start account deletion"
      >
        <div className="form-stack">
          {deleteAccount.error && (
            <ErrorState
              description={friendlyApiError(deleteAccount.error)}
              title="Workflow not started"
            />
          )}
          <Field
            autoComplete="off"
            hint="Type DELETE exactly to continue."
            label="Confirmation"
            onChange={(event) => setDeleteConfirmation(event.target.value)}
            value={deleteConfirmation}
          />
          <div className="form-actions">
            <Button onClick={() => setDeleteOpen(false)} variant="ghost">
              Cancel
            </Button>
            <Button
              busy={deleteAccount.isPending}
              disabled={deleteConfirmation !== 'DELETE'}
              onClick={() => deleteAccount.mutate()}
              variant="danger"
            >
              Start workflow
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function SessionRow({
  onRevoke,
  pending,
  session,
}: {
  onRevoke: (id: string) => void;
  pending: boolean;
  session: SessionRecord;
}) {
  return (
    <div className="session-row">
      <span className="session-row__icon">
        {session.deviceName.toLowerCase().includes('phone') ? (
          <Smartphone aria-hidden="true" />
        ) : (
          <Laptop aria-hidden="true" />
        )}
      </span>
      <span>
        <strong>{session.deviceName}</strong>
        <small>
          {session.location ? `${session.location} · ` : ''}Last active{' '}
          {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
            new Date(session.lastSeenAt),
          )}
        </small>
      </span>
      {session.current ? (
        <StatusBadge tone="positive">This device</StatusBadge>
      ) : (
        <Button busy={pending} onClick={() => onRevoke(session.id)} size="sm" variant="secondary">
          Revoke
        </Button>
      )}
    </div>
  );
}

export function SecurityPage() {
  const queryClient = useQueryClient();
  const user = useQuery({ queryKey: ['me'], queryFn: api.currentUser, retry: false });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: api.sessions });
  const revoke = useMutation({
    mutationFn: api.revokeSession,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
  const capabilities = new Set(user.data?.capabilities ?? []);
  return (
    <div className="page-stack">
      <PageIntro
        eyebrow="Account protection"
        title="Security and sessions"
        description="Server-side sessions can be revoked remotely; offline device data follows the documented disconnected-device limitation."
      />
      <Card>
        <CardHeader>
          <div>
            <span className="eyebrow">Signed-in devices</span>
            <h2>Active sessions</h2>
          </div>
          <LockKeyhole aria-hidden="true" />
        </CardHeader>
        <CardContent>
          {sessions.isLoading && <PageSkeleton cards={3} />}
          {sessions.error && (
            <ApiErrorPanel error={sessions.error} onRetry={() => void sessions.refetch()} />
          )}
          {sessions.data?.items.length === 0 && (
            <EmptyState
              description="No active session records were returned."
              icon={Laptop}
              title="No sessions found"
            />
          )}
          {sessions.data && (
            <div className="session-list">
              {sessions.data.items.map((session) => (
                <SessionRow
                  key={session.id}
                  onRevoke={(id) => revoke.mutate(id)}
                  pending={revoke.isPending && revoke.variables === session.id}
                  session={session}
                />
              ))}
            </div>
          )}
          {revoke.error && (
            <ErrorState description={friendlyApiError(revoke.error)} title="Session not revoked" />
          )}
        </CardContent>
      </Card>
      <div className="security-grid">
        <Card>
          <CardHeader>
            <div>
              <span className="eyebrow">Stronger sign-in</span>
              <h2>Passkeys</h2>
            </div>
            <KeyRound aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <p className="muted">
              Use device-bound public-key credentials when this sign-in option becomes available.
            </p>
            {capabilities.has('passkeys') ? (
              <StatusBadge tone="positive">Available</StatusBadge>
            ) : (
              <StatusBadge tone="neutral">Not available</StatusBadge>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <span className="eyebrow">Second factor</span>
              <h2>Authenticator app</h2>
            </div>
            <Smartphone aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <p className="muted">
              TOTP setup includes encrypted secrets and hashed single-use recovery codes.
            </p>
            {capabilities.has('totp') ? (
              <StatusBadge tone="positive">Available</StatusBadge>
            ) : (
              <StatusBadge tone="neutral">Not available</StatusBadge>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

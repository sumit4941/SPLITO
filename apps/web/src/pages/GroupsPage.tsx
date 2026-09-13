import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  Field,
  Modal,
  SelectField,
  StatusBadge,
} from '@splito/ui';
import {
  Archive,
  BarChart3,
  Camera,
  ChevronLeft,
  CircleCheck,
  Clock3,
  MessageSquareText,
  Plus,
  ShieldCheck,
  Users,
  WalletCards,
} from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router-dom';
import { z } from 'zod';
import { api } from '../api/client';
import { ApiErrorPanel, PageSkeleton } from '../components/ApiStates';
import { AddGroupMemberDialog } from '../components/AddGroupMemberDialog';
import { ImageUploadDialog } from '../components/ImageUploadDialog';
import {
  AnimatedGrid,
  AnimatedItem,
  Avatar,
  ExpenseList,
  GroupArtwork,
  MoneyAmount,
  PageIntro,
} from '../components/PageElements';
import { supportedCurrencies } from '../lib/money';
import type { CursorPage, GroupDetail, GroupSummary, MoneyValue } from '../types';

const groupSchema = z.object({
  name: z.string().trim().min(2, 'Give the group a descriptive name.').max(120),
  description: z.string().trim().max(500).optional(),
  type: z.enum(['home', 'trip', 'couple', 'family', 'project', 'other']),
  defaultCurrency: z.string().length(3),
});

type GroupValues = z.infer<typeof groupSchema>;

function GroupBalance({ value }: { value?: MoneyValue | MoneyValue[] }) {
  if (!value) return <span className="muted">No posted balance</span>;
  const values = Array.isArray(value) ? value : [value];
  return (
    <span className="group-card__balances">
      {values.map((balance) => (
        <MoneyAmount amount={balance} key={balance.currency} showSign />
      ))}
    </span>
  );
}

export function GroupsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const queryClient = useQueryClient();
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.groups() });
  const form = useForm<GroupValues>({
    resolver: zodResolver(groupSchema),
    defaultValues: { defaultCurrency: 'INR', description: '', name: '', type: 'trip' },
  });
  const create = useMutation({
    mutationFn: api.createGroup,
    async onSuccess() {
      await queryClient.invalidateQueries({ queryKey: ['groups'] });
      form.reset();
      setCreateOpen(false);
    },
  });

  return (
    <div className="page-stack">
      <PageIntro
        actions={
          <Button icon={Plus} onClick={() => setCreateOpen(true)}>
            New group
          </Button>
        }
        eyebrow="Contexts stay separate"
        title="Groups for every shared orbit"
        description="A trip, home, or event keeps its own people, permissions, balances, and currency settings."
      />
      {groups.isLoading && <PageSkeleton cards={6} />}
      {groups.error && <ApiErrorPanel error={groups.error} onRetry={() => void groups.refetch()} />}
      {groups.data && groups.data.items.length === 0 && (
        <Card>
          <EmptyState
            action={
              <Button icon={Plus} onClick={() => setCreateOpen(true)}>
                Create your first group
              </Button>
            }
            description="Groups organize expenses without merging unrelated debts."
            icon={WalletCards}
            title="Your orbit is ready"
          />
        </Card>
      )}
      {groups.data && groups.data.items.length > 0 && (
        <AnimatedGrid className="group-grid">
          {groups.data.items.map((group, index) => (
            <AnimatedItem key={group.id}>
              <Link className="group-card" to={`/groups/${group.id}`}>
                <div className={`group-card__art group-card__art--${index % 4}`}>
                  <GroupArtwork group={group} />
                  {group.archived && (
                    <StatusBadge>
                      <Archive aria-hidden="true" size={12} />
                      Archived
                    </StatusBadge>
                  )}
                </div>
                <div className="group-card__body">
                  <span className="eyebrow">
                    {group.type ?? 'Group'} · {group.defaultCurrency}
                  </span>
                  <h2>{group.name}</h2>
                  <p>{group.description || 'No description has been added.'}</p>
                  <div className="group-card__meta">
                    <span>
                      <Users aria-hidden="true" size={16} />
                      {group.memberCount ?? '—'} people
                    </span>
                    <GroupBalance value={group.myBalance} />
                  </div>
                </div>
              </Link>
            </AnimatedItem>
          ))}
        </AnimatedGrid>
      )}

      <Modal
        description="You can invite people and set a default split after creation."
        onOpenChange={setCreateOpen}
        open={createOpen}
        title="Create a group"
      >
        <form
          className="form-stack"
          noValidate
          onSubmit={form.handleSubmit((values) => create.mutate(values))}
        >
          {create.error && <ApiErrorPanel error={create.error} />}
          <Field
            error={form.formState.errors.name?.message}
            label="Group name"
            placeholder="Goa weekend"
            {...form.register('name')}
          />
          <Field
            error={form.formState.errors.description?.message}
            label="Description"
            placeholder="Travel, stay, and food for the trip"
            {...form.register('description')}
          />
          <div className="form-grid form-grid--two">
            <SelectField label="Group type" {...form.register('type')}>
              <option value="trip">Trip</option>
              <option value="home">Home</option>
              <option value="couple">Couple</option>
              <option value="family">Family</option>
              <option value="project">Project or activity</option>
              <option value="other">Other</option>
            </SelectField>
            <SelectField label="Default currency" {...form.register('defaultCurrency')}>
              {supportedCurrencies.map((currency) => (
                <option key={currency}>{currency}</option>
              ))}
            </SelectField>
          </div>
          <div className="form-actions">
            <Button onClick={() => setCreateOpen(false)} type="button" variant="ghost">
              Cancel
            </Button>
            <Button busy={create.isPending} type="submit">
              {create.isPending ? 'Creating…' : 'Create group'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

type GroupTab = 'expenses' | 'balances' | 'people';

export function GroupDetailPage() {
  const { groupId = '' } = useParams();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<GroupTab>('expenses');
  const [imageOpen, setImageOpen] = useState(false);
  const [memberOpen, setMemberOpen] = useState(false);
  const group = useQuery({
    queryKey: ['groups', groupId],
    queryFn: () => api.group(groupId),
    enabled: Boolean(groupId),
  });
  const expenses = useQuery({
    queryKey: ['groups', groupId, 'expenses'],
    queryFn: () => api.groupExpenses(groupId),
    enabled: Boolean(groupId),
  });
  const balances = useQuery({
    queryKey: ['groups', groupId, 'balances'],
    queryFn: () => api.groupBalances(groupId),
    enabled: Boolean(groupId) && tab === 'balances',
  });
  const setGroupImage = (imageUrl?: string) => {
    queryClient.setQueryData<GroupDetail>(['groups', groupId], (current) => {
      if (!current) return current;
      const detail = { ...current };
      delete detail.imageUrl;
      return imageUrl ? { ...detail, imageUrl } : detail;
    });
    queryClient.setQueryData<CursorPage<GroupSummary>>(['groups'], (current) => {
      if (!current) return current;
      return {
        ...current,
        items: current.items.map((item) => {
          if (item.id !== groupId) return item;
          const summary = { ...item };
          delete summary.imageUrl;
          return imageUrl ? { ...summary, imageUrl } : summary;
        }),
      };
    });
  };
  const uploadGroupImage = useMutation({
    mutationFn: (file: File) => api.uploadGroupImage(groupId, file),
    async onSuccess(result) {
      setGroupImage(result.url);
      await queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
  });
  const removeGroupImage = useMutation({
    mutationFn: () => api.removeGroupImage(groupId),
    async onSuccess() {
      setGroupImage();
      await queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
  });
  const addMember = useMutation({
    mutationFn: (mobileNumber: string) => api.addGroupMember(groupId, mobileNumber),
    async onSuccess(result) {
      queryClient.setQueryData<GroupDetail>(['groups', groupId], (current) => {
        if (!current) return current;
        if (result.outcome === 'member_added') {
          const alreadyPresent = current.members.some((member) => member.id === result.member.id);
          return {
            ...current,
            memberCount: alreadyPresent ? current.memberCount : (current.memberCount ?? 0) + 1,
            members: alreadyPresent
              ? current.members.map((member) =>
                  member.id === result.member.id ? result.member : member,
                )
              : [...current.members, result.member],
          };
        }
        const pending = current.pendingInvitations ?? [];
        return {
          ...current,
          pendingInvitations: [
            ...pending.filter((invitation) => invitation.id !== result.invitation.id),
            result.invitation,
          ],
        };
      });
      await queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
  });

  if (group.isLoading) return <PageSkeleton cards={4} />;
  if (group.error)
    return <ApiErrorPanel error={group.error} onRetry={() => void group.refetch()} />;
  if (!group.data) return null;
  const canManageImage =
    !group.data.archived && (group.data.role === 'owner' || group.data.role === 'administrator');
  const canManageMembers =
    !group.data.archived && (group.data.role === 'owner' || group.data.role === 'administrator');

  return (
    <div className="page-stack">
      <Link className="back-link" to="/groups">
        <ChevronLeft aria-hidden="true" size={17} />
        All groups
      </Link>
      <section className="group-hero">
        <div className="group-hero__art">
          <GroupArtwork group={group.data} />
          {canManageImage && (
            <button
              aria-label={group.data.imageUrl ? 'Change group picture' : 'Add group picture'}
              className="group-hero__image-action"
              onClick={() => setImageOpen(true)}
              title={group.data.imageUrl ? 'Change group picture' : 'Add group picture'}
              type="button"
            >
              <Camera aria-hidden="true" size={16} />
            </button>
          )}
        </div>
        <div className="group-hero__copy">
          <span className="eyebrow">
            {group.data.type ?? 'Group'} · {group.data.defaultCurrency}
          </span>
          <h1>{group.data.name}</h1>
          <p>{group.data.description || 'No group description.'}</p>
          <div>
            <StatusBadge tone={group.data.archived ? 'neutral' : 'positive'}>
              {group.data.archived ? 'Read-only archive' : 'Active'}
            </StatusBadge>
            {group.data.simplificationEnabled && (
              <StatusBadge tone="info">Simplification on</StatusBadge>
            )}
          </div>
        </div>
        <div className="group-hero__actions">
          <Button asChild icon={Plus} disabled={group.data.archived}>
            <Link to={`/expenses/new?group=${groupId}`}>Add expense</Link>
          </Button>
          {canManageImage && (
            <Button icon={Camera} onClick={() => setImageOpen(true)} variant="secondary">
              Group picture
            </Button>
          )}
        </div>
      </section>

      <ImageUploadDialog
        currentUrl={group.data.imageUrl}
        displayName={group.data.name}
        kind="group"
        onOpenChange={setImageOpen}
        onRemove={async () => {
          await removeGroupImage.mutateAsync();
        }}
        onUpload={async (file) => {
          await uploadGroupImage.mutateAsync(file);
        }}
        open={imageOpen}
      />
      <AddGroupMemberDialog
        groupName={group.data.name}
        onAdd={(mobileNumber) => addMember.mutateAsync(mobileNumber)}
        onOpenChange={setMemberOpen}
        open={memberOpen}
      />

      <div aria-label="Group views" className="tabs" role="tablist">
        <button
          aria-selected={tab === 'expenses'}
          onClick={() => setTab('expenses')}
          role="tab"
          type="button"
        >
          Expenses
        </button>
        <button
          aria-selected={tab === 'balances'}
          onClick={() => setTab('balances')}
          role="tab"
          type="button"
        >
          Balances
        </button>
        <button
          aria-selected={tab === 'people'}
          onClick={() => setTab('people')}
          role="tab"
          type="button"
        >
          People <span>{group.data.members.length}</span>
        </button>
      </div>

      {tab === 'expenses' && (
        <Card>
          <CardHeader>
            <div>
              <span className="eyebrow">Authoritative records</span>
              <h2>Expenses</h2>
            </div>
          </CardHeader>
          <CardContent>
            {expenses.isLoading && <PageSkeleton cards={3} />}
            {expenses.error && (
              <ApiErrorPanel error={expenses.error} onRetry={() => void expenses.refetch()} />
            )}
            {expenses.data && expenses.data.items.length === 0 && (
              <EmptyState
                action={
                  !group.data.archived && (
                    <Button asChild size="sm">
                      <Link to={`/expenses/new?group=${groupId}`}>Add an expense</Link>
                    </Button>
                  )
                }
                description="Only successfully posted entries will affect this group's balances."
                title="No posted expenses"
              />
            )}
            {expenses.data && expenses.data.items.length > 0 && (
              <ExpenseList expenses={expenses.data.items} />
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'balances' && (
        <Card>
          <CardHeader>
            <div>
              <span className="eyebrow">Per currency</span>
              <h2>Group balances</h2>
            </div>
            <Button asChild size="sm" variant="secondary">
              <Link to={`/analytics?group=${groupId}`}>
                <BarChart3 aria-hidden="true" size={16} />
                Analytics
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {balances.isLoading && <PageSkeleton cards={3} />}
            {balances.error && (
              <ApiErrorPanel error={balances.error} onRetry={() => void balances.refetch()} />
            )}
            {balances.data && balances.data.items.length === 0 && (
              <EmptyState
                description="There are no outstanding balances in this group."
                icon={CircleCheck}
                title="This group is settled"
              />
            )}
            {balances.data && balances.data.items.length > 0 && (
              <div className="balance-lines">
                {balances.data.items.map((balance) => (
                  <div className="balance-line" key={`${balance.contextId}-${balance.currency}`}>
                    <span>
                      <strong>{balance.contextName ?? 'Your balance'}</strong>
                      <small>{balance.currency} remains independent</small>
                    </span>
                    <MoneyAmount
                      amount={{ amountMinor: balance.netAmountMinor, currency: balance.currency }}
                      showSign
                    />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'people' && (
        <Card>
          <CardHeader>
            <div>
              <span className="eyebrow">Membership</span>
              <h2>People</h2>
            </div>
            {canManageMembers && (
              <Button icon={Plus} onClick={() => setMemberOpen(true)} size="sm" variant="secondary">
                Add person
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <div className="people-list">
              {group.data.members.map((member) => (
                <div className="person-row" key={member.id}>
                  <Avatar participant={member} />
                  <span>
                    <strong>{member.displayName}</strong>
                    <small>{member.status ?? 'active'}</small>
                  </span>
                  <StatusBadge tone={member.role === 'owner' ? 'info' : 'neutral'}>
                    {member.role ?? 'member'}
                  </StatusBadge>
                </div>
              ))}
            </div>
            {canManageMembers && Boolean(group.data.pendingInvitations?.length) && (
              <section className="pending-invitations" aria-labelledby="pending-invitations-title">
                <div className="pending-invitations__heading">
                  <span>
                    <MessageSquareText aria-hidden="true" />
                  </span>
                  <div>
                    <h3 id="pending-invitations-title">Pending SMS invitations</h3>
                    <p>These people are not group members and cannot appear in an expense yet.</p>
                  </div>
                </div>
                <div className="pending-invitations__list">
                  {group.data.pendingInvitations?.map((invitation) => (
                    <div className="pending-invitation" key={invitation.id}>
                      <span className="pending-invitation__icon">
                        <Clock3 aria-hidden="true" />
                      </span>
                      <span>
                        <strong>{invitation.maskedMobileNumber}</strong>
                        <small>
                          Expires{' '}
                          {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
                            new Date(invitation.expiresAt),
                          )}
                        </small>
                      </span>
                      <StatusBadge tone="warning">
                        <ShieldCheck aria-hidden="true" size={12} />
                        Pending
                      </StatusBadge>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

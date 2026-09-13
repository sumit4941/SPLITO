import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  Field,
  SelectField,
  StatusBadge,
} from '@splito/ui';
import {
  Activity,
  CalendarClock,
  FileSearch,
  Plus,
  ReceiptText,
  Search,
  Users,
} from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { ApiErrorPanel, PageSkeleton } from '../components/ApiStates';
import { ExpenseList, PageIntro } from '../components/PageElements';
import { formatMinor, majorToMinor, supportedCurrencies } from '../lib/money';

export function FriendsPage() {
  return (
    <div className="page-stack">
      <PageIntro
        eyebrow="Group membership"
        title="People you share with"
        description="People are managed inside each group, keeping members, invitations, and shared expenses together."
      />
      <Card>
        <EmptyState
          action={
            <Button asChild size="sm">
              <Link to="/groups">View groups</Link>
            </Button>
          }
          description="Open a group to view its members and pending invitations, or to add someone."
          icon={Users}
          title="Find people in your groups"
        />
      </Card>
    </div>
  );
}

export function ActivityPage() {
  const activity = useQuery({ queryKey: ['activity'], queryFn: () => api.activity() });
  return (
    <div className="page-stack">
      <PageIntro
        eyebrow="Authorized history"
        title="Activity that affects you"
        description="Financial changes remain visible with actor, time, and status; inaccessible records never appear."
      />
      {activity.isLoading && <PageSkeleton cards={5} />}
      {activity.error && (
        <ApiErrorPanel error={activity.error} onRetry={() => void activity.refetch()} />
      )}
      {activity.data?.items.length === 0 && (
        <Card>
          <EmptyState
            description="Posted expenses, settlements, invitations, and sync results will appear here."
            icon={Activity}
            title="No activity yet"
          />
        </Card>
      )}
      {activity.data && activity.data.items.length > 0 && (
        <Card>
          <CardContent>
            <ol className="activity-list">
              {activity.data.items.map((item) => (
                <li key={item.id}>
                  <span className="activity-list__dot" />
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                    <small>
                      {item.actorName ? `${item.actorName} · ` : ''}
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(item.occurredAt))}
                    </small>
                  </div>
                  {item.status && (
                    <StatusBadge
                      tone={
                        item.status === 'failed'
                          ? 'negative'
                          : item.status === 'pending'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {item.status}
                    </StatusBadge>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface SearchForm {
  query: string;
  category: string;
  currency: string;
  dateFrom: string;
  dateTo: string;
  groupId: string;
  participantId: string;
  receipt: string;
  minAmount: string;
  maxAmount: string;
}

const initialSearch: SearchForm = {
  category: '',
  currency: 'INR',
  dateFrom: '',
  dateTo: '',
  groupId: '',
  maxAmount: '',
  minAmount: '',
  participantId: '',
  query: '',
  receipt: '',
};

export function SearchPage() {
  const [form, setForm] = useState<SearchForm>(initialSearch);
  const [submitted, setSubmitted] = useState<SearchForm>();
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.groups() });
  const selectedGroup = useQuery({
    queryKey: ['groups', form.groupId],
    queryFn: () => api.group(form.groupId),
    enabled: Boolean(form.groupId),
  });
  const filters = useMemo(
    () =>
      submitted
        ? {
            ...submitted,
            maxAmountMinor: submitted.maxAmount
              ? (majorToMinor(submitted.maxAmount, submitted.currency) ?? undefined)
              : undefined,
            minAmountMinor: submitted.minAmount
              ? (majorToMinor(submitted.minAmount, submitted.currency) ?? undefined)
              : undefined,
            maxAmount: undefined,
            minAmount: undefined,
          }
        : undefined,
    [submitted],
  );
  const results = useQuery({
    queryKey: ['search', filters],
    queryFn: () => api.search(filters!),
    enabled: Boolean(filters),
  });
  const set = (key: keyof SearchForm, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted({ ...form });
  };

  return (
    <div className="page-stack">
      <PageIntro
        eyebrow="Permission-filtered"
        title="Find an expense"
        description="Search results and counts only include records you are authorized to read."
      />
      <Card>
        <CardContent>
          <form className="search-form" onSubmit={submit}>
            <Field
              className="search-form__query"
              label="Description or keyword"
              leading={<Search aria-hidden="true" size={18} />}
              onChange={(event) => set('query', event.target.value)}
              placeholder="Dinner, rent, taxi…"
              value={form.query}
            />
            <SelectField
              label="Group"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  groupId: event.target.value,
                  participantId: '',
                }))
              }
              value={form.groupId}
            >
              <option value="">Any group</option>
              {groups.data?.items.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              disabled={!form.groupId || selectedGroup.isLoading}
              label="Person"
              onChange={(event) => set('participantId', event.target.value)}
              value={form.participantId}
            >
              <option value="">{form.groupId ? 'Any group member' : 'Choose a group first'}</option>
              {selectedGroup.data?.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Category"
              onChange={(event) => set('category', event.target.value)}
              value={form.category}
            >
              <option value="">Any category</option>
              <option value="food">Food & dining</option>
              <option value="transport">Transport</option>
              <option value="home">Home</option>
              <option value="utilities">Utilities</option>
              <option value="shopping">Shopping</option>
            </SelectField>
            <SelectField
              label="Currency"
              onChange={(event) => set('currency', event.target.value)}
              value={form.currency}
            >
              {supportedCurrencies.map((currency) => (
                <option key={currency}>{currency}</option>
              ))}
            </SelectField>
            <Field
              label="Minimum amount"
              inputMode="decimal"
              onChange={(event) => set('minAmount', event.target.value)}
              value={form.minAmount}
            />
            <Field
              label="Maximum amount"
              inputMode="decimal"
              onChange={(event) => set('maxAmount', event.target.value)}
              value={form.maxAmount}
            />
            <Field
              label="From date"
              onChange={(event) => set('dateFrom', event.target.value)}
              type="date"
              value={form.dateFrom}
            />
            <Field
              label="To date"
              onChange={(event) => set('dateTo', event.target.value)}
              type="date"
              value={form.dateTo}
            />
            <SelectField
              label="Receipt"
              onChange={(event) => set('receipt', event.target.value)}
              value={form.receipt}
            >
              <option value="">With or without</option>
              <option value="true">Has receipt</option>
              <option value="false">No receipt</option>
            </SelectField>
            <div className="search-form__actions">
              <Button type="submit">Search expenses</Button>
              <Button
                onClick={() => {
                  setForm(initialSearch);
                  setSubmitted(undefined);
                }}
                type="button"
                variant="ghost"
              >
                Clear
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      {results.isLoading && <PageSkeleton cards={4} />}
      {results.error && (
        <ApiErrorPanel error={results.error} onRetry={() => void results.refetch()} />
      )}
      {submitted && results.data?.items.length === 0 && (
        <Card>
          <EmptyState
            description="Try widening the filters. SPLITO does not reveal inaccessible matches."
            icon={FileSearch}
            title="No authorized matches"
          />
        </Card>
      )}
      {results.data && results.data.items.length > 0 && (
        <Card>
          <CardHeader>
            <div>
              <span className="eyebrow">Results</span>
              <h2>{results.data.items.length} expenses</h2>
            </div>
          </CardHeader>
          <CardContent>
            <ExpenseList expenses={results.data.items} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function RecurringPage() {
  const recurring = useQuery({ queryKey: ['recurrence'], queryFn: api.recurring });
  const unavailable = 'Recurring schedules are not available yet.';
  return (
    <div className="page-stack">
      <PageIntro
        actions={
          <Button disabled icon={Plus} title={unavailable}>
            Scheduling coming soon
          </Button>
        }
        eyebrow="Independent occurrences"
        title="Recurring expenses"
        description="Schedules preserve local wall-clock intent, prevent duplicates, and pause when membership makes a template invalid."
      />
      {recurring.isLoading && <PageSkeleton cards={4} />}
      {recurring.error && (
        <ApiErrorPanel error={recurring.error} onRetry={() => void recurring.refetch()} />
      )}
      {recurring.data?.items.length === 0 && (
        <Card>
          <EmptyState
            action={
              <Button disabled size="sm" title={unavailable}>
                Scheduling coming soon
              </Button>
            }
            description="Rent, subscriptions, and routine shared costs can start here."
            icon={CalendarClock}
            title="No recurring expenses"
          />
        </Card>
      )}
      {recurring.data && recurring.data.items.length > 0 && (
        <div className="recurring-grid">
          {recurring.data.items.map((item) => (
            <Card key={item.id}>
              <CardContent>
                <span className="recurring-card__icon">
                  <CalendarClock aria-hidden="true" />
                </span>
                <div>
                  <span className="eyebrow">{item.frequency}</span>
                  <h2>{item.description}</h2>
                  <p>{item.groupName ?? 'Direct expense'}</p>
                  <strong>{formatMinor(item.amount.amountMinor, item.amount.currency)}</strong>
                  {item.nextOccurrenceAt && (
                    <small>
                      Next:{' '}
                      {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
                        new Date(item.nextOccurrenceAt),
                      )}{' '}
                      · {item.timezone}
                    </small>
                  )}
                </div>
                <StatusBadge
                  tone={
                    item.status === 'active'
                      ? 'positive'
                      : item.status === 'attention'
                        ? 'negative'
                        : 'warning'
                  }
                >
                  {item.status}
                </StatusBadge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReceiptsPage() {
  const receipts = useQuery({ queryKey: ['receipts'], queryFn: api.receipts });
  return (
    <div className="page-stack">
      <PageIntro
        actions={
          <Button asChild icon={Plus}>
            <Link to="/expenses/new">Add with receipt</Link>
          </Button>
        }
        eyebrow="Private uploads"
        title="Receipt inbox"
        description="OCR output is editable and must be confirmed before it can become a posted expense."
      />
      {receipts.isLoading && <PageSkeleton cards={4} />}
      {receipts.error && (
        <ApiErrorPanel error={receipts.error} onRetry={() => void receipts.refetch()} />
      )}
      {receipts.data?.items.length === 0 && (
        <Card>
          <EmptyState
            action={
              <Button asChild size="sm">
                <Link to="/expenses/new">Add an expense</Link>
              </Button>
            }
            description="Image and PDF receipts attached to authorized expenses will appear here."
            icon={ReceiptText}
            title="No receipts"
          />
        </Card>
      )}
      {receipts.data && receipts.data.items.length > 0 && (
        <Card>
          <CardContent>
            <div className="receipt-list">
              {receipts.data.items.map((receipt) => (
                <Link
                  className="receipt-row"
                  key={receipt.id}
                  to={receipt.expenseId ? `/expenses/${receipt.expenseId}` : '/receipts'}
                >
                  <span className="receipt-row__icon">
                    <ReceiptText aria-hidden="true" />
                  </span>
                  <span>
                    <strong>{receipt.merchant ?? receipt.fileName}</strong>
                    <small>
                      {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
                        new Date(receipt.uploadedAt),
                      )}
                      {receipt.confidence ? ` · ${receipt.confidence} confidence` : ''}
                    </small>
                  </span>
                  {receipt.total && (
                    <strong>
                      {formatMinor(receipt.total.amountMinor, receipt.total.currency)}
                    </strong>
                  )}
                  <StatusBadge
                    tone={
                      receipt.status === 'confirmed'
                        ? 'positive'
                        : receipt.status === 'failed'
                          ? 'negative'
                          : receipt.status === 'needs_review'
                            ? 'warning'
                            : 'info'
                    }
                  >
                    {receipt.status.replace('_', ' ')}
                  </StatusBadge>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

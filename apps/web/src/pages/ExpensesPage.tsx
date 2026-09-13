import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  ErrorState,
  Field,
  SelectField,
  StatusBadge,
  cn,
} from '@splito/ui';
import {
  ArrowLeft,
  Check,
  CloudOff,
  FileImage,
  Info,
  Paperclip,
  Pencil,
  ReceiptText,
  Save,
  Sparkles,
  Upload,
  UserRoundCheck,
  Users,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { api, friendlyApiError } from '../api/client';
import { ApiErrorPanel, PageSkeleton } from '../components/ApiStates';
import { Avatar, MoneyAmount, PageIntro } from '../components/PageElements';
import {
  formatMinor,
  majorToMinor,
  minorToMajor,
  signedMajorToMinor,
  supportedCurrencies,
} from '../lib/money';
import { deleteExpenseDraft, queueExpenseMutation, saveExpenseDraft } from '../lib/offline';
import type { ExpenseSummary, Participant, SplitPreview } from '../types';

const expenseSchema = z.object({
  description: z.string().trim().min(2, 'Describe what this expense was for.').max(240),
  amountMajor: z.string().trim().min(1, 'Enter the total amount.'),
  currency: z.string().length(3),
  expenseDate: z.string().min(1, 'Choose the expense date.'),
  category: z.string().min(1, 'Choose a category.'),
  groupId: z.string().min(1, 'Choose a group.'),
  notes: z.string().max(2_000).optional(),
  splitMethod: z.enum(['equal', 'exact', 'percentage', 'shares', 'adjustments']),
});

export type ExpenseValues = z.infer<typeof expenseSchema>;
export type SplitEntry = { included: boolean; paidMajor: string; value: string };
export type SplitEntries = Record<string, SplitEntry>;

const splitDescriptions: Record<ExpenseValues['splitMethod'], string> = {
  equal: 'The total is divided evenly. Any remainder follows the persisted participant order.',
  exact: "Enter each beneficiary's exact amount. The amounts must match the total.",
  percentage: 'Enter decimal percentages that add to exactly 100.',
  shares: 'Use non-negative relative weights; at least one share must be positive.',
  adjustments:
    "Each share is the common base plus that person's adjustment. Negative resulting shares are rejected.",
};

export function canEditExpense(expense: Pick<ExpenseSummary, 'canEdit'>): boolean {
  return expense.canEdit === true;
}

export function expenseEditValues(expense: ExpenseSummary): ExpenseValues {
  return {
    amountMajor: minorToMajor(expense.amount.amountMinor, expense.amount.currency),
    category: expense.category ?? 'general',
    currency: expense.amount.currency,
    description: expense.description,
    expenseDate: expense.expenseDate,
    groupId: expense.groupId ?? '',
    notes: expense.notes ?? '',
    splitMethod: expense.splitMethod ?? 'equal',
  };
}

export function expenseEditEntries(expense: ExpenseSummary, members: Participant[]): SplitEntries {
  const payers = new Map(expense.payers?.map((payer) => [payer.id, payer]) ?? []);
  const allocations = new Map(
    expense.allocations?.map((allocation) => [allocation.id, allocation]) ?? [],
  );
  const method = expense.splitMethod ?? 'equal';
  return Object.fromEntries(
    members
      .filter((member) => member.status !== 'former')
      .map((member) => {
        const payer = payers.get(member.id);
        const allocation = allocations.get(member.id);
        let value = '';
        if (allocation) {
          if (method === 'exact') {
            value = minorToMajor(
              allocation.inputValue ?? allocation.owedAmountMinor,
              expense.amount.currency,
            );
          } else if (method === 'adjustments') {
            value = minorToMajor(allocation.inputValue ?? '0', expense.amount.currency);
          } else if (method === 'percentage' || method === 'shares') {
            value = allocation.inputValue ?? '';
          }
        }
        return [
          member.id,
          {
            included: Boolean(allocation),
            paidMajor: payer ? minorToMajor(payer.paidAmountMinor, expense.amount.currency) : '',
            value,
          },
        ];
      }),
  );
}

function buildExpensePayload(values: ExpenseValues, entries: SplitEntries) {
  const amountMinor = majorToMinor(values.amountMajor, values.currency);
  if (!amountMinor || BigInt(amountMinor) <= 0n)
    throw new Error('Enter a positive amount with valid currency precision.');
  const payers = Object.entries(entries)
    .map(([participantId, entry]) => ({
      participantId,
      paidAmountMinor: majorToMinor(entry.paidMajor || '0', values.currency),
    }))
    .filter((entry): entry is { participantId: string; paidAmountMinor: string } =>
      Boolean(entry.paidAmountMinor && BigInt(entry.paidAmountMinor) > 0n),
    );
  const beneficiaries = Object.entries(entries)
    .filter(([, entry]) => entry.included)
    .map(([participantId, entry]) => {
      const base = { participantId };
      if (values.splitMethod === 'equal') return base;
      if (values.splitMethod === 'exact')
        return {
          ...base,
          amountMinor: majorToMinor(entry.value || '0', values.currency) ?? 'invalid',
        };
      if (values.splitMethod === 'percentage') return { ...base, percentage: entry.value || '0' };
      if (values.splitMethod === 'shares') return { ...base, shares: entry.value || '0' };
      return {
        ...base,
        adjustmentMinor: signedMajorToMinor(entry.value || '0', values.currency) ?? 'invalid',
      };
    });
  if (payers.length === 0) throw new Error('Add at least one payer and the amount they paid.');
  if (beneficiaries.length === 0) throw new Error('Select at least one beneficiary.');
  return {
    amountMinor,
    beneficiaries,
    category: values.category,
    currency: values.currency,
    description: values.description.trim(),
    expenseDate: values.expenseDate,
    groupId: values.groupId,
    notes: values.notes?.trim() || undefined,
    originalSplitInputs: beneficiaries,
    payers,
    splitMethod: values.splitMethod,
  };
}

function EntryEditor({
  currency,
  entries,
  method,
  members,
  onChange,
}: {
  currency: string;
  entries: SplitEntries;
  method: ExpenseValues['splitMethod'];
  members: Participant[];
  onChange: (id: string, patch: Partial<SplitEntry>, manualPayer?: boolean) => void;
}) {
  const valueLabel =
    method === 'exact'
      ? `Owes (${currency})`
      : method === 'percentage'
        ? 'Percent'
        : method === 'shares'
          ? 'Shares'
          : method === 'adjustments'
            ? `Adjustment (${currency})`
            : 'Included';
  return (
    <div className="split-table" role="group" aria-label="Payers and beneficiaries">
      <div className="split-table__head">
        <span>Person</span>
        <span>Paid ({currency})</span>
        <span>{valueLabel}</span>
      </div>
      {members.map((member) => {
        const entry = entries[member.id] ?? {
          included: true,
          paidMajor: '',
          value: method === 'shares' ? '1' : '',
        };
        return (
          <div className="split-table__row" key={member.id}>
            <label className="split-person">
              <input
                aria-label={`${member.displayName} is included`}
                checked={entry.included}
                onChange={(event) => onChange(member.id, { included: event.target.checked })}
                type="checkbox"
              />
              <Avatar participant={member} size="sm" />
              <span>{member.displayName}</span>
            </label>
            <label>
              <span className="sr-only">Amount paid by {member.displayName}</span>
              <input
                inputMode="decimal"
                onChange={(event) => onChange(member.id, { paidMajor: event.target.value }, true)}
                placeholder="0.00"
                value={entry.paidMajor}
              />
            </label>
            {method === 'equal' ? (
              <span className={cn('split-included', entry.included && 'split-included--yes')}>
                {entry.included ? (
                  <>
                    <Check aria-hidden="true" size={15} />
                    Equal
                  </>
                ) : (
                  'Excluded'
                )}
              </span>
            ) : (
              <label>
                <span className="sr-only">
                  {valueLabel} for {member.displayName}
                </span>
                <input
                  disabled={!entry.included}
                  inputMode="decimal"
                  onChange={(event) => onChange(member.id, { value: event.target.value })}
                  placeholder={method === 'shares' ? '1' : '0'}
                  value={entry.value}
                />
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PreviewPanel({
  error,
  loading,
  preview,
}: {
  error?: unknown;
  loading: boolean;
  preview?: SplitPreview;
}) {
  return (
    <Card className="preview-card">
      <CardHeader>
        <div>
          <span className="eyebrow">Server preview</span>
          <h2>Who owes what</h2>
        </div>
        {loading && <StatusBadge tone="info">Calculating…</StatusBadge>}
        {preview && !loading && (
          <StatusBadge tone="positive">
            <Check aria-hidden="true" size={12} />
            Balanced
          </StatusBadge>
        )}
      </CardHeader>
      <CardContent>
        {Boolean(error) && (
          <ErrorState description={friendlyApiError(error)} title="Preview needs attention" />
        )}
        {!error && !preview && (
          <div className="preview-placeholder">
            <Sparkles aria-hidden="true" />
            <p>
              Complete the total, payer amounts, and beneficiaries to request an authoritative
              preview.
            </p>
          </div>
        )}
        {preview && (
          <div className="preview-lines" aria-live="polite">
            {preview.allocations.map((allocation) => (
              <div key={allocation.participantId}>
                <span>
                  <strong>{allocation.displayName ?? allocation.participantId}</strong>
                  <small>
                    Paid {formatMinor(allocation.paidAmountMinor, preview.currency)} · owes{' '}
                    {formatMinor(allocation.owedAmountMinor, preview.currency)}
                  </small>
                </span>
                <MoneyAmount
                  amount={{ amountMinor: allocation.netAmountMinor, currency: preview.currency }}
                  showSign
                />
              </div>
            ))}
            <p className="preview-explanation">
              <Info aria-hidden="true" size={16} />
              {preview.explanation ??
                'Backend results are authoritative and use deterministic minor-unit allocation.'}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ExpenseComposerPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { expenseId = '' } = useParams();
  const editing = Boolean(expenseId);
  const [searchParams] = useSearchParams();
  const user = useQuery({ queryKey: ['me'], queryFn: api.currentUser, retry: false });
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.groups() });
  const currentExpense = useQuery({
    queryKey: ['expenses', expenseId],
    queryFn: () => api.expense(expenseId),
    enabled: editing,
  });
  const initialGroup = searchParams.get('group') ?? '';
  const form = useForm<ExpenseValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      amountMajor: '',
      category: 'general',
      currency: user.data?.defaultCurrency ?? 'INR',
      description: '',
      expenseDate: new Date().toISOString().slice(0, 10),
      groupId: initialGroup,
      notes: '',
      splitMethod: 'equal',
    },
  });
  const values = useWatch({ control: form.control });
  const groupId = values.groupId ?? '';
  const group = useQuery({
    queryKey: ['groups', groupId],
    queryFn: () => api.group(groupId),
    enabled: Boolean(groupId),
  });
  const [entries, setEntries] = useState<SplitEntries>({});
  const [payersEdited, setPayersEdited] = useState(false);
  const [receipt, setReceipt] = useState<File>();
  const [draftLabel, setDraftLabel] = useState('Draft not saved');
  const [localError, setLocalError] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  const draftId = useRef<string | undefined>(undefined);
  const hydratedExpenseVersion = useRef<string | undefined>(undefined);
  const hydratedEntriesVersion = useRef<string | undefined>(undefined);
  const idempotencyKey = useRef(crypto.randomUUID());
  const receiptIdempotencyKey = useRef(crypto.randomUUID());

  useEffect(() => {
    if (editing || !user.data?.defaultCurrency || form.formState.dirtyFields.currency) return;
    form.setValue('currency', user.data.defaultCurrency);
  }, [editing, form, user.data?.defaultCurrency]);

  useEffect(() => {
    if (!group.data) return;
    setEntries((current) =>
      Object.fromEntries(
        group.data.members
          .filter((member) => member.status !== 'former')
          .map((member) => [
            member.id,
            current[member.id] ?? {
              included: !editing,
              paidMajor: !editing && member.id === user.data?.id ? (values.amountMajor ?? '') : '',
              value:
                values.splitMethod === 'shares'
                  ? '1'
                  : values.splitMethod === 'adjustments'
                    ? '0'
                    : '',
            },
          ]),
      ),
    );
  }, [editing, group.data, user.data?.id]);

  useEffect(() => {
    if (
      !editing ||
      !currentExpense.data ||
      hydratedExpenseVersion.current === String(currentExpense.data.version ?? '')
    ) {
      return;
    }
    form.reset(expenseEditValues(currentExpense.data));
    setPayersEdited(true);
    setDraftLabel(`Editing revision ${currentExpense.data.revisionNumber ?? '—'}`);
    hydratedExpenseVersion.current = String(currentExpense.data.version ?? '');
  }, [currentExpense.data, editing, form]);

  useEffect(() => {
    if (
      !editing ||
      !currentExpense.data ||
      !group.data ||
      hydratedEntriesVersion.current === String(currentExpense.data.version ?? '')
    ) {
      return;
    }
    setEntries(expenseEditEntries(currentExpense.data, group.data.members));
    hydratedEntriesVersion.current = String(currentExpense.data.version ?? '');
  }, [currentExpense.data, editing, group.data]);

  useEffect(() => {
    const userId = user.data?.id;
    if (editing || payersEdited || !userId || !entries[userId]) return;
    setEntries((current) => ({
      ...current,
      [userId]: { ...current[userId], paidMajor: values.amountMajor ?? '' },
    }));
  }, [editing, entries[user.data?.id ?? ''], payersEdited, user.data?.id, values.amountMajor]);

  useEffect(() => {
    const method = values.splitMethod;
    if (!method) return;
    setEntries((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, entry]) => [
          id,
          {
            ...entry,
            value:
              method === 'shares' && !entry.value
                ? '1'
                : method === 'adjustments' && !entry.value
                  ? '0'
                  : entry.value,
          },
        ]),
      ),
    );
  }, [values.splitMethod]);

  const previewPayload = useMemo(() => {
    try {
      return buildExpensePayload(values as ExpenseValues, entries);
    } catch {
      return undefined;
    }
  }, [entries, values]);
  const preview = useMutation({ mutationFn: api.splitPreview });

  useEffect(() => {
    if (!previewPayload || !navigator.onLine) {
      preview.reset();
      return;
    }
    const timer = window.setTimeout(() => preview.mutate(previewPayload), 450);
    return () => window.clearTimeout(timer);
  }, [previewPayload]);

  useEffect(() => {
    if (editing || !form.formState.isDirty || (!values.description && !values.amountMajor)) return;
    const accountId = user.data?.id ?? 'anonymous';
    setDraftLabel('Saving draft…');
    const timer = window.setTimeout(async () => {
      const saved = await saveExpenseDraft(accountId, { form: values, entries }, draftId.current);
      draftId.current = saved.id;
      setDraftLabel('Draft saved on this device');
    }, 800);
    return () => window.clearTimeout(timer);
  }, [editing, entries, form.formState.isDirty, user.data?.id, values]);

  const saveExpense = useMutation({
    mutationFn: async ({ file, payload }: { file?: File; payload: Record<string, unknown> }) => {
      const expense = editing
        ? await api.updateExpense(
            expenseId,
            payload,
            currentExpense.data?.version ?? '',
            idempotencyKey.current,
          )
        : await api.createExpense(payload, idempotencyKey.current);
      let attachmentError: string | undefined;
      if (file) {
        try {
          await api.uploadReceipt(expense.id, file, receiptIdempotencyKey.current);
        } catch (error) {
          attachmentError = friendlyApiError(error);
        }
      }
      return { attachmentError, expense };
    },
    async onSuccess(result) {
      queryClient.setQueryData(['expenses', result.expense.id], result.expense);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['balances'] }),
        queryClient.invalidateQueries({ queryKey: ['groups', result.expense.groupId, 'expenses'] }),
        queryClient.invalidateQueries({ queryKey: ['expenses', result.expense.id] }),
      ]);
      if (draftId.current) await deleteExpenseDraft(draftId.current);
      setConfirmed(true);
      window.setTimeout(
        () =>
          navigate(`/expenses/${result.expense.id}`, {
            replace: true,
            state: { attachmentError: result.attachmentError },
          }),
        850,
      );
    },
  });

  const updateEntry = (id: string, patch: Partial<SplitEntry>, manualPayer = false) => {
    if (manualPayer) setPayersEdited(true);
    setEntries((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  };

  const onSubmit = async (validValues: ExpenseValues) => {
    setLocalError(undefined);
    let payload: Record<string, unknown>;
    try {
      payload = buildExpensePayload(validValues, entries);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Check the split details.');
      return;
    }

    if (!navigator.onLine && editing) {
      setLocalError('Reconnect before editing an expense. Existing posted records stay unchanged.');
      return;
    }
    if (!navigator.onLine) {
      await queueExpenseMutation(user.data?.id ?? 'anonymous', payload);
      if (draftId.current) await deleteExpenseDraft(draftId.current);
      void navigate('/offline', { state: { queued: true } });
      return;
    }
    saveExpense.mutate({ file: receipt, payload });
  };

  if (editing && (currentExpense.isLoading || user.isLoading)) return <PageSkeleton cards={4} />;
  if (editing && currentExpense.error) {
    return (
      <ApiErrorPanel error={currentExpense.error} onRetry={() => void currentExpense.refetch()} />
    );
  }
  if (editing && currentExpense.data && !canEditExpense(currentExpense.data)) {
    return (
      <div className="page-stack">
        <Link className="back-link" to={`/expenses/${expenseId}`}>
          <ArrowLeft aria-hidden="true" size={17} />
          Back to expense
        </Link>
        <ErrorState
          action={
            <Button asChild variant="secondary">
              <Link to={`/expenses/${expenseId}`}>View expense</Link>
            </Button>
          }
          description="Every active group member can view this entry, but only the person who added it can create a new revision."
          title="This expense is read-only for you"
        />
      </div>
    );
  }

  return (
    <div className="page-stack composer-page">
      <PageIntro
        eyebrow={editing ? 'Current entry → preview → revision' : 'Draft → preview → post'}
        title={editing ? 'Edit your expense' : 'Add an expense'}
        description={
          editing
            ? 'The original record stays in history. Saving posts a balanced replacement revision for every group member.'
            : 'Nothing affects balances until SPLITO validates and saves the posted expense.'
        }
      />
      <form className="composer-layout" noValidate onSubmit={form.handleSubmit(onSubmit)}>
        <div className="composer-main">
          {(localError || saveExpense.error) && (
            <ErrorState
              description={localError ?? friendlyApiError(saveExpense.error)}
              title={editing ? 'Expense not updated' : 'Expense not posted'}
            />
          )}
          <Card>
            <CardHeader>
              <div>
                <span className="step-number">01</span>
                <h2>The expense</h2>
              </div>
              <StatusBadge tone="neutral">
                <Save aria-hidden="true" size={12} />
                {draftLabel}
              </StatusBadge>
            </CardHeader>
            <CardContent className="form-stack">
              <div className="form-grid form-grid--amount">
                <Field
                  className="form-grid__description"
                  error={form.formState.errors.description?.message}
                  label="Description"
                  placeholder="Dinner at Candolim"
                  {...form.register('description')}
                />
                <SelectField label="Currency" {...form.register('currency')}>
                  {supportedCurrencies.map((currency) => (
                    <option key={currency}>{currency}</option>
                  ))}
                </SelectField>
                <Field
                  error={form.formState.errors.amountMajor?.message}
                  inputMode="decimal"
                  label="Total"
                  placeholder="0.00"
                  {...form.register('amountMajor')}
                />
              </div>
              <div className="form-grid form-grid--three">
                <SelectField
                  disabled={editing}
                  error={form.formState.errors.groupId?.message}
                  label="Group"
                  {...form.register('groupId')}
                >
                  <option value="">Choose a group</option>
                  {groups.data?.items.map((item) => (
                    <option disabled={item.archived} key={item.id} value={item.id}>
                      {item.name}
                      {item.archived ? ' (archived)' : ''}
                    </option>
                  ))}
                </SelectField>
                <Field
                  error={form.formState.errors.expenseDate?.message}
                  label="Expense date"
                  type="date"
                  {...form.register('expenseDate')}
                />
                <SelectField label="Category" {...form.register('category')}>
                  <option value="general">General</option>
                  <option value="food">Food & dining</option>
                  <option value="transport">Transport</option>
                  <option value="home">Home</option>
                  <option value="utilities">Utilities</option>
                  <option value="shopping">Shopping</option>
                  <option value="entertainment">Entertainment</option>
                </SelectField>
              </div>
              <Field
                label="Notes (optional)"
                placeholder="Add context for everyone involved"
                {...form.register('notes')}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <span className="step-number">02</span>
                <h2>Payers and split</h2>
              </div>
              <StatusBadge tone="info">
                <Users aria-hidden="true" size={12} />
                {group.data?.members.length ?? 0} people
              </StatusBadge>
            </CardHeader>
            <CardContent className="form-stack">
              <div aria-label="Split method" className="segmented" role="radiogroup">
                {(['equal', 'exact', 'percentage', 'shares', 'adjustments'] as const).map(
                  (method) => (
                    <button
                      aria-checked={values.splitMethod === method}
                      key={method}
                      onClick={() => form.setValue('splitMethod', method, { shouldDirty: true })}
                      role="radio"
                      type="button"
                    >
                      {method === 'adjustments' ? '+/− adjust' : method}
                    </button>
                  ),
                )}
              </div>
              <p className="method-explanation">
                <Info aria-hidden="true" size={16} />
                {splitDescriptions[values.splitMethod ?? 'equal']}
              </p>
              {group.isLoading && <PageSkeleton cards={2} />}
              {group.error && (
                <ApiErrorPanel error={group.error} onRetry={() => void group.refetch()} />
              )}
              {!groupId && (
                <div className="inline-empty">
                  <Users aria-hidden="true" />
                  <p>Choose a group to load eligible participants.</p>
                </div>
              )}
              {group.data && (
                <EntryEditor
                  currency={values.currency ?? 'INR'}
                  entries={entries}
                  members={group.data.members.filter((member) => member.status !== 'former')}
                  method={values.splitMethod ?? 'equal'}
                  onChange={updateEntry}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <span className="step-number">03</span>
                <h2>{editing ? 'Add receipt' : 'Receipt'}</h2>
              </div>
              <StatusBadge tone="neutral">Optional</StatusBadge>
            </CardHeader>
            <CardContent>
              <label className={cn('receipt-drop', receipt && 'receipt-drop--selected')}>
                <input
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(event) => setReceipt(event.target.files?.[0])}
                  type="file"
                />
                <span className="receipt-drop__icon">
                  {receipt ? <FileImage aria-hidden="true" /> : <Upload aria-hidden="true" />}
                </span>
                <span>
                  <strong>{receipt ? receipt.name : 'Choose a photo or PDF'}</strong>
                  <small>
                    {receipt
                      ? `${Math.ceil(receipt.size / 1024)} KB · uploads after the expense commits`
                      : 'SPLITO validates the file type, size, and access. Receipt scanning never changes balances automatically.'}
                  </small>
                </span>
                {receipt && (
                  <Button
                    onClick={(event) => {
                      event.preventDefault();
                      setReceipt(undefined);
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Remove
                  </Button>
                )}
              </label>
            </CardContent>
          </Card>
        </div>

        <aside className="composer-side">
          {!navigator.onLine && (
            <div className="offline-callout">
              <CloudOff aria-hidden="true" />
              <span>
                <strong>Working offline</strong>
                <small>
                  Submitting queues this expense; balances stay unchanged until sync succeeds.
                </small>
              </span>
            </div>
          )}
          <PreviewPanel error={preview.error} loading={preview.isPending} preview={preview.data} />
          <div className="composer-submit">
            <Button
              busy={saveExpense.isPending}
              disabled={!group.data || confirmed}
              size="lg"
              type="submit"
            >
              {editing ? 'Save new revision' : navigator.onLine ? 'Post expense' : 'Queue for sync'}
            </Button>
            <Button asChild variant="ghost">
              <Link to={groupId ? `/groups/${groupId}` : '/'}>Cancel</Link>
            </Button>
            <p>
              <Paperclip aria-hidden="true" size={14} />
              Financial success appears only after server confirmation.
            </p>
          </div>
        </aside>
      </form>
      <AnimatePresence>
        {confirmed && (
          <motion.div
            animate={{ opacity: 1 }}
            aria-live="assertive"
            className="success-overlay"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            role="status"
          >
            <motion.div
              animate={{ scale: 1 }}
              initial={{ scale: 0.7 }}
              transition={{ type: 'spring', stiffness: 230, damping: 17 }}
            >
              <span>
                <Check aria-hidden="true" size={30} />
              </span>
              <h2>{editing ? 'Expense updated' : 'Expense posted'}</h2>
              <p>
                {editing
                  ? 'The server saved a new balanced revision.'
                  : 'The server confirmed the financial change.'}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ExpenseDetailPage() {
  const { expenseId = '' } = useParams();
  const location = useLocation();
  const expense = useQuery({
    queryKey: ['expenses', expenseId],
    queryFn: () => api.expense(expenseId),
    enabled: Boolean(expenseId),
  });

  if (expense.isLoading) return <PageSkeleton cards={4} />;
  if (expense.error)
    return <ApiErrorPanel error={expense.error} onRetry={() => void expense.refetch()} />;
  if (!expense.data) return null;
  const item = expense.data;
  const editable = canEditExpense(item);
  return (
    <div className="page-stack">
      <Link className="back-link" to={item.groupId ? `/groups/${item.groupId}` : '/'}>
        <ArrowLeft aria-hidden="true" size={17} />
        Back
      </Link>
      <PageIntro
        actions={
          editable ? (
            <Button asChild icon={Pencil} variant="secondary">
              <Link to={`/expenses/${item.id}/edit`}>Edit your entry</Link>
            </Button>
          ) : undefined
        }
        eyebrow={`${item.category ?? 'General'} · ${item.expenseDate}`}
        title={item.description}
        description={
          item.createdBy
            ? `Added by ${item.createdBy.displayName}. Every active group member can view the latest server-confirmed revision.`
            : 'Every active group member can view the latest server-confirmed revision.'
        }
      />
      {(location.state as { attachmentError?: string } | null)?.attachmentError && (
        <ErrorState
          description={(location.state as { attachmentError: string }).attachmentError}
          title="Expense posted; receipt upload failed"
        />
      )}
      <div className="expense-detail-grid">
        <Card className="expense-total-card">
          <CardContent>
            <span className="eyebrow">Total expense</span>
            <strong>{formatMinor(item.amount.amountMinor, item.amount.currency)}</strong>
            <div>
              <StatusBadge
                tone={
                  item.status === 'posted'
                    ? 'positive'
                    : item.status === 'voided'
                      ? 'negative'
                      : 'warning'
                }
              >
                {item.status ?? 'posted'}
              </StatusBadge>
              <span>Revision {item.revisionNumber ?? item.version ?? '—'}</span>
            </div>
            {item.createdBy && (
              <div className="expense-creator">
                <UserRoundCheck aria-hidden="true" size={17} />
                <span>
                  Added by <strong>{item.createdBy.displayName}</strong>
                  {editable ? ' · You can edit this entry' : ' · View only'}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <span className="eyebrow">Payment sources</span>
              <h2>Who paid</h2>
            </div>
          </CardHeader>
          <CardContent>
            {item.payers?.length ? (
              <div className="people-list">
                {item.payers.map((payer) => (
                  <div className="person-row" key={payer.id}>
                    <Avatar participant={payer} />
                    <span>
                      <strong>{payer.displayName}</strong>
                      <small>Payer</small>
                    </span>
                    <strong>{formatMinor(payer.paidAmountMinor, item.amount.currency)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">Payer details were not included in this response.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <span className="eyebrow">Final allocations</span>
              <h2>Who owes</h2>
            </div>
          </CardHeader>
          <CardContent>
            {item.allocations?.length ? (
              <div className="people-list">
                {item.allocations.map((allocation) => (
                  <div className="person-row" key={allocation.id}>
                    <Avatar participant={allocation} />
                    <span>
                      <strong>{allocation.displayName}</strong>
                      <small>Beneficiary</small>
                    </span>
                    <strong>{formatMinor(allocation.owedAmountMinor, item.amount.currency)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">Allocation details were not included in this response.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <span className="eyebrow">Private files</span>
              <h2>Receipts</h2>
            </div>
          </CardHeader>
          <CardContent>
            {item.attachments?.length ? (
              item.attachments.map((attachment) => (
                <div className="attachment-row" key={attachment.id}>
                  <ReceiptText aria-hidden="true" />
                  <span>
                    <strong>{attachment.fileName}</strong>
                    <small>{attachment.status ?? 'available'}</small>
                  </span>
                </div>
              ))
            ) : (
              <p className="muted">No receipt is attached.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

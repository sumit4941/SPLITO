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
} from '@splito/ui';
import { ArrowRight, BadgeCheck, Building2, Check, Info, ShieldCheck } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { api, friendlyApiError } from '../api/client';
import { ApiErrorPanel, PageSkeleton } from '../components/ApiStates';
import { Avatar, PageIntro } from '../components/PageElements';
import { formatMinor, majorToMinor, supportedCurrencies } from '../lib/money';

const settlementSchema = z
  .object({
    groupId: z.string().min(1, 'Choose a group.'),
    senderId: z.string().min(1, 'Choose who paid.'),
    recipientId: z.string().min(1, 'Choose who received it.'),
    amountMajor: z.string().min(1, 'Enter the payment amount.'),
    currency: z.string().length(3),
    settlementDate: z.string().min(1),
    method: z.string().min(1),
    note: z.string().max(1_000).optional(),
  })
  .refine((value) => value.senderId !== value.recipientId, {
    message: 'Sender and recipient must be different.',
    path: ['recipientId'],
  });

type SettlementValues = z.infer<typeof settlementSchema>;

function settlementPayload(values: SettlementValues) {
  const amountMinor = majorToMinor(values.amountMajor, values.currency);
  if (!amountMinor || BigInt(amountMinor) <= 0n)
    throw new Error('Enter a positive amount with valid currency precision.');
  return {
    amountMinor,
    context: { id: values.groupId, type: 'group' },
    currency: values.currency,
    method: values.method,
    note: values.note?.trim() || undefined,
    recipientId: values.recipientId,
    senderId: values.senderId,
    settlementDate: values.settlementDate,
  };
}

export function SettlementPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUser = useQuery({ queryKey: ['me'], queryFn: api.currentUser, retry: false });
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.groups() });
  const form = useForm<SettlementValues>({
    resolver: zodResolver(settlementSchema),
    defaultValues: {
      amountMajor: '',
      currency: currentUser.data?.defaultCurrency ?? 'INR',
      groupId: searchParams.get('group') ?? '',
      method: 'cash',
      note: '',
      recipientId: '',
      senderId: currentUser.data?.id ?? '',
      settlementDate: new Date().toISOString().slice(0, 10),
    },
  });
  const values = useWatch({ control: form.control });
  const group = useQuery({
    queryKey: ['groups', values.groupId],
    queryFn: () => api.group(values.groupId ?? ''),
    enabled: Boolean(values.groupId),
  });
  const [confirmedOverpayment, setConfirmedOverpayment] = useState(false);
  const [posted, setPosted] = useState(false);
  const [localError, setLocalError] = useState<string>();
  const idempotencyKey = useRef(crypto.randomUUID());

  useEffect(() => {
    if (currentUser.data?.id && !form.getValues('senderId'))
      form.setValue('senderId', currentUser.data.id);
    if (currentUser.data?.defaultCurrency && !form.formState.dirtyFields.currency)
      form.setValue('currency', currentUser.data.defaultCurrency);
  }, [currentUser.data, form]);

  const payload = useMemo(() => {
    try {
      return settlementPayload(values as SettlementValues);
    } catch {
      return undefined;
    }
  }, [values]);
  const preview = useMutation({ mutationFn: api.settlementPreview });

  useEffect(() => {
    setConfirmedOverpayment(false);
    if (!payload || !navigator.onLine) {
      preview.reset();
      return;
    }
    const timer = window.setTimeout(() => preview.mutate(payload), 400);
    return () => window.clearTimeout(timer);
  }, [payload]);

  const create = useMutation({
    mutationFn: ({ body }: { body: Record<string, unknown> }) =>
      api.createSettlement(body, idempotencyKey.current),
    async onSuccess() {
      setPosted(true);
      await queryClient.invalidateQueries({ queryKey: ['balances'] });
      window.setTimeout(() => navigate('/', { replace: true }), 950);
    },
  });

  const onSubmit = (validValues: SettlementValues) => {
    setLocalError(undefined);
    if (!navigator.onLine) {
      setLocalError(
        'Settlement recording is online-only because balances must be rechecked immediately.',
      );
      return;
    }
    let body: Record<string, unknown>;
    try {
      body = settlementPayload(validValues);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Check the payment details.');
      return;
    }
    if (!preview.data) {
      setLocalError('Wait for a current settlement preview before recording.');
      return;
    }
    if (preview.data.overpayment && !confirmedOverpayment) {
      setLocalError('Confirm the overpayment before recording it.');
      return;
    }
    create.mutate({
      body: {
        ...body,
        overpaymentConfirmed: confirmedOverpayment,
        previewVersion: preview.data.previewVersion,
      },
    });
  };

  return (
    <div className="page-stack">
      <PageIntro
        eyebrow="Manual settlement"
        title="Record money that moved"
        description="This records your assertion of payment. It is not confirmation from a bank or payment provider."
      />
      {!navigator.onLine && (
        <ErrorState
          description="Reconnect to preview current balances and record a settlement."
          title="Settlement is online-only"
        />
      )}
      <div className="settlement-layout">
        <form className="settlement-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          {(localError || create.error) && (
            <ErrorState
              description={localError ?? friendlyApiError(create.error)}
              title="Settlement not recorded"
            />
          )}
          <Card>
            <CardHeader>
              <div>
                <span className="eyebrow">Context and amount</span>
                <h2>Payment details</h2>
              </div>
              <StatusBadge tone="warning">
                <Info aria-hidden="true" size={12} />
                User asserted
              </StatusBadge>
            </CardHeader>
            <CardContent className="form-stack">
              <SelectField
                error={form.formState.errors.groupId?.message}
                label="Group"
                {...form.register('groupId')}
              >
                <option value="">Choose a group</option>
                {groups.data?.items.map((item) => (
                  <option disabled={item.archived} key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </SelectField>
              {group.isLoading && <PageSkeleton cards={2} />}
              {group.error && (
                <ApiErrorPanel error={group.error} onRetry={() => void group.refetch()} />
              )}
              {group.data && (
                <div className="settlement-people">
                  <label>
                    <span>Sender · who paid</span>
                    <select {...form.register('senderId')}>
                      <option value="">Choose sender</option>
                      {group.data.members
                        .filter((member) => member.status !== 'former')
                        .map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.displayName}
                          </option>
                        ))}
                    </select>
                  </label>
                  <ArrowRight aria-hidden="true" />
                  <label>
                    <span>Recipient · who received</span>
                    <select
                      aria-invalid={Boolean(form.formState.errors.recipientId)}
                      {...form.register('recipientId')}
                    >
                      <option value="">Choose recipient</option>
                      {group.data.members
                        .filter((member) => member.status !== 'former')
                        .map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.displayName}
                          </option>
                        ))}
                    </select>
                    {form.formState.errors.recipientId && (
                      <small className="field-error">
                        {form.formState.errors.recipientId.message}
                      </small>
                    )}
                  </label>
                </div>
              )}
              <div className="form-grid form-grid--three">
                <SelectField label="Currency" {...form.register('currency')}>
                  {supportedCurrencies.map((currency) => (
                    <option key={currency}>{currency}</option>
                  ))}
                </SelectField>
                <Field
                  error={form.formState.errors.amountMajor?.message}
                  inputMode="decimal"
                  label="Amount"
                  placeholder="0.00"
                  {...form.register('amountMajor')}
                />
                <Field label="Payment date" type="date" {...form.register('settlementDate')} />
              </div>
              <SelectField label="How it was paid" {...form.register('method')}>
                <option value="cash">Cash</option>
                <option value="bank">Bank transfer</option>
                <option value="upi">UPI (record only)</option>
                <option value="card">Card</option>
                <option value="other">Other</option>
              </SelectField>
              <Field
                label="Note (optional)"
                placeholder="Reference or context visible to participants"
                {...form.register('note')}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <span className="eyebrow">Current-balance check</span>
                <h2>Review before recording</h2>
              </div>
              {preview.isPending && <StatusBadge tone="info">Refreshing…</StatusBadge>}
            </CardHeader>
            <CardContent>
              {preview.error && <ApiErrorPanel error={preview.error} />}
              {!preview.data && !preview.error && (
                <div className="inline-empty">
                  <ShieldCheck aria-hidden="true" />
                  <p>Complete the details to preview how this payment affects current balances.</p>
                </div>
              )}
              {preview.data && (
                <div className="settlement-review">
                  <p>
                    <BadgeCheck aria-hidden="true" />
                    {preview.data.explanation ??
                      'SPLITO compared this payment with current balances.'}
                  </p>
                  {preview.data.outstandingAmountMinor && (
                    <div>
                      <span>Current outstanding amount</span>
                      <strong>
                        {formatMinor(preview.data.outstandingAmountMinor, values.currency ?? 'INR')}
                      </strong>
                    </div>
                  )}
                  {preview.data.overpayment && (
                    <label className="warning-check">
                      <input
                        checked={confirmedOverpayment}
                        onChange={(event) => setConfirmedOverpayment(event.target.checked)}
                        type="checkbox"
                      />
                      <span>
                        <strong>This payment exceeds the current amount owed</strong>
                        <small>I reviewed the amount and want to record the overpayment.</small>
                      </span>
                    </label>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="form-actions form-actions--sticky">
            <Button asChild variant="ghost">
              <Link to="/">Cancel</Link>
            </Button>
            <Button
              busy={create.isPending}
              disabled={!navigator.onLine || posted}
              size="lg"
              type="submit"
            >
              Record settlement
            </Button>
          </div>
        </form>

        <aside className="settlement-aside">
          <div className="settlement-orbit">
            <span>
              {group.data && values.senderId ? (
                <Avatar
                  participant={
                    group.data.members.find((member) => member.id === values.senderId) ?? {
                      displayName: '?',
                    }
                  }
                  size="lg"
                />
              ) : (
                'A'
              )}
            </span>
            <div>
              <ArrowRight aria-hidden="true" />
            </div>
            <span>
              {group.data && values.recipientId ? (
                <Avatar
                  participant={
                    group.data.members.find((member) => member.id === values.recipientId) ?? {
                      displayName: '?',
                    }
                  }
                  size="lg"
                />
              ) : (
                'B'
              )}
            </span>
          </div>
          <h2>A settlement changes balances, not spending.</h2>
          <p>
            Expense history stays intact. If the payment is later disputed or reversed, SPLITO
            records that history separately.
          </p>
          <div className="provider-note">
            <Building2 aria-hidden="true" />
            <span>
              <strong>No bank verification</strong>
              <small>
                UPI and provider assistance remain distinct from ledger settlement confirmation.
              </small>
            </span>
          </div>
        </aside>
      </div>
      <AnimatePresence>
        {posted && (
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
              <h2>Settlement confirmed</h2>
              <p>The payment record is saved.</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

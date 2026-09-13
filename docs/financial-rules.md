# Financial rules

These rules are normative for previews, API validation, persistence, and
reconciliation. The shared domain package implements the pure calculations; the
server remains authoritative.

## Representation and bounds

- A money value is `{ currency, amountMinor }`, where `amountMinor` is a base-10
  integer string at JSON boundaries and a `BigInt` internally.
- The domain and Oracle bound is `0..9,999,999,999,999,999,999` for unsigned
  document/allocation amounts. Signed postings use the corresponding negative
  bound. Values outside it are rejected before SQL.
- `NUMBER(19,0)` is fetched as text. No financial path converts it to a binary
  floating-point JavaScript `Number`.
- Currency metadata defines zero, two, or three decimal places. Formatting never
  changes stored minor units.
- Percentages, shares, adjustments, quantities, and rates are parsed as decimal
  strings into integers plus powers of ten. Allocation inputs allow at most 12
  fractional digits; FX rate storage allows up to 30 for provider fidelity.

For a positive expense total `T`:

```text
sum(paid[i]) = T
sum(owed[i]) = T
net[i] = paid[i] - owed[i]
sum(net[i]) = 0
```

Positive net means receivable; negative net means payable. Participants with
zero net are retained in the revision allocation but omitted from ledger
postings because `SPLITO_LEDGER_POSTINGS` forbids meaningless zero rows.

## Deterministic largest remainder v1

For nonnegative rational weights, calculate every exact rational entitlement,
take its floor in minor units, and distribute the remaining units by descending
fractional remainder. Ties use persisted `allocationOrder`, then canonical
participant ID. Final allocations and `splito-largest-remainder-v1` are stored. This
makes previews, retries, and server recalculation identical.

Methods:

- Equal: every selected beneficiary has weight 1.
- Exact: explicit nonnegative minor-unit values must sum exactly to `T`.
- Percentage: bounded decimal values must sum exactly to 100 as rationals.
- Shares: bounded nonnegative decimal weights need at least one positive value.
- Adjustments: with `n` participants,
  `base = (T - sum(adjustment[i])) / n`, then
  `owed[i] = base + adjustment[i]`. The calculation is rational before rounding;
  any negative owed result is rejected.
- Itemized: each reconciled line/charge is allocated independently and the final
  per-participant values are summed. Order-wide discounts are proportional to
  eligible net items by default; tax and service follow eligible net items; tip
  is proportional unless equal or exact is explicitly selected.

Persisted order is part of the financial input, not presentation decoration.
Changing group membership later cannot change an old result.

## Worked examples

| Input                                           | Persisted owed amounts             |
| ----------------------------------------------- | ---------------------------------- |
| ₹100.00 equally among A/B/C, order A-B-C        | ₹33.34 / ₹33.33 / ₹33.33           |
| ₹1,000.00 with shares 1:2:3                     | ₹166.67 / ₹333.33 / ₹500.00        |
| ₹1,000.00 at 55%/45%                            | ₹550.00 / ₹450.00                  |
| ₹1,000.00 adjustments +₹100/₹0                  | base ₹450; ₹550.00 / ₹450.00       |
| A pays ₹600, B pays ₹400; A/B/C/D owe ₹250 each | nets +₹350 / +₹150 / −₹250 / −₹250 |

## Bilateral attribution

For one expense, sort creditors and debtors by persisted allocation order, then
participant ID, and match their remaining absolute nets until exhausted. Store
the resulting `splito-bilateral-order-v1` obligations. Aggregate reverse directions
within the same context and currency into the signed ordered-pair projection.

This is SPLITO's deterministic attribution policy; it is not presented as an
undocumented behavior of any reference product.

## Journal and changes

Each committed batch belongs to one context and one currency and its signed
postings sum to zero. Document heads may change, but revisions and journal rows
do not. Editing or voiding appends a batch that exactly negates the previous
batch. A replacement/restored revision gets a new batch. The API verifies sums
before insert and in the transaction; reconciliation independently searches for
unbalanced batches.

For the implemented expense replacement route, read and write permissions are
deliberately different. Every active member of the group may see the current
expense, creator, payers, and allocations. Only the participant recorded in
`SPLITO_EXPENSES.CREATED_BY_PARTICIPANT_ID` may replace it, and that participant
must still have active membership while the context and expense are writable.
Being a group owner, administrator, payer, or beneficiary does not grant edit
authority. The response's `canEdit` flag is computed from these server-side
facts and is presentation guidance, not the authorization control itself.

Replacement requires both an actor/operation-scoped idempotency key and the
current resource version in `If-Match`. The transaction locks the current head,
checks creator ownership, rejects a cross-group move, and then:

1. loads the exact postings and obligations for the current revision;
2. appends a `REVERSAL` batch whose postings and bilateral deltas negate that
   effect in its original currency;
3. appends revision `N + 1` and a balanced replacement expense batch in the new
   revision's currency (which may differ);
4. adjusts net and bilateral projections by those reversal and replacement
   deltas; and
5. stores the audit event, minimal outbox invalidation, and idempotent HTTP
   outcome before commit.

No previous revision, payer/share row, obligation, batch, or posting is updated
or deleted. A stale fresh request returns `412`. An identical retry with the
same completed idempotency key returns the stored outcome without a second
revision or journal effect; reuse of that key with different input is a
conflict. Focused unit tests exercise this orchestration and authorization. The
post-V006 live Oracle smoke flow, projection reconciliation, Oracle-backed
worker integration, and complete repository verification pipeline also pass.

Settlements are transfers, not spending. For `S` sent from A to B, A receives a
`+S` net posting and B receives `−S`. A manual record is explicitly a user
assertion. A provider attempt remains outside the ledger until an authenticated,
fresh, replay-safe authoritative provider callback confirms success.

Refunds are positive linked documents, never ambiguous negative expenses. The
record distinguishes who received cash from who receives economic credit. The
transaction locks the original expense and rejects cumulative posted refunds
above its amount. It appends balanced signed postings and preserves the original.

## Simplification

For each group and currency independently, sort debtors by most negative balance
and creditors by most positive balance; match the largest amounts, breaking ties
by stable participant ID. Repeat until all temporary balances are zero. The
preview contains the projection version; committing a settlement rejects a stale
version.

The greedy result preserves every participant's net but is not guaranteed to use
the mathematical minimum number of transfers. It only changes suggestions. It
does not rewrite original obligations or the journal.

## Currency conversion and analytics

Different currencies never offset. Estimated display conversion records rate
source, quote time, and stale status but writes no journal. Explicit conversion
requires a preview and confirmation, stores the decimal rate and rounding
policy, and creates balanced batches in both source and target currencies.

Spending analytics use posted expense dates, exclude voided revisions and
settlements, and reduce spending by linked posted refunds. Mixed-currency charts
are forbidden unless each original series remains labelled or a display
conversion basis is shown.

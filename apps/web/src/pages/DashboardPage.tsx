import { useQuery } from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, EmptyState, StatusBadge } from '@splito/ui';
import {
  ArrowRight,
  CircleCheck,
  Clock3,
  Plus,
  ReceiptText,
  Repeat2,
  Search,
  WalletCards,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { ApiErrorPanel, PageSkeleton } from '../components/ApiStates';
import {
  AnimatedGrid,
  AnimatedItem,
  FeatureLinkCard,
  GroupArtwork,
  MoneyAmount,
  PageIntro,
} from '../components/PageElements';
import { compareMinor } from '../lib/money';

export function DashboardPage() {
  const balances = useQuery({ queryKey: ['balances'], queryFn: api.balances });
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.groups() });

  if (balances.isLoading && groups.isLoading) return <PageSkeleton cards={4} />;

  return (
    <div className="page-stack">
      <PageIntro
        actions={
          <>
            <Button asChild icon={Plus}>
              <Link to="/expenses/new">Add expense</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to="/settle">Settle up</Link>
            </Button>
          </>
        }
        eyebrow="Live balances"
        title="Money, without the mental maths."
        description="Every currency stays separate, and pending offline work never masquerades as an authoritative balance."
      />

      {balances.error && (
        <ApiErrorPanel
          error={balances.error}
          onRetry={() => void balances.refetch()}
          title="Balances are unavailable"
        />
      )}
      {balances.data && balances.data.items.length > 0 ? (
        <AnimatedGrid className="balance-grid">
          {balances.data.items.map((balance) => {
            const direction = compareMinor(balance.netAmountMinor);
            return (
              <AnimatedItem key={`${balance.contextId ?? 'personal'}-${balance.currency}`}>
                <Card
                  className={`balance-card balance-card--${direction > 0 ? 'positive' : direction < 0 ? 'negative' : 'settled'}`}
                >
                  <CardContent>
                    <div className="balance-card__top">
                      <span>{balance.contextName ?? 'Personal balance'}</span>
                      <StatusBadge
                        tone={direction > 0 ? 'positive' : direction < 0 ? 'negative' : 'neutral'}
                      >
                        {direction > 0 ? 'You are owed' : direction < 0 ? 'You owe' : 'Settled'}
                      </StatusBadge>
                    </div>
                    <MoneyAmount
                      amount={{ amountMinor: balance.netAmountMinor, currency: balance.currency }}
                      showSign
                    />
                    <div className="balance-card__split">
                      <span>
                        <small>To receive</small>
                        <strong>
                          {balance.receivableAmountMinor ? (
                            <MoneyAmount
                              amount={{
                                amountMinor: balance.receivableAmountMinor,
                                currency: balance.currency,
                              }}
                            />
                          ) : (
                            '—'
                          )}
                        </strong>
                      </span>
                      <span>
                        <small>You owe</small>
                        <strong>
                          {balance.owedAmountMinor ? (
                            <MoneyAmount
                              amount={{
                                amountMinor: `-${balance.owedAmountMinor.replace('-', '')}`,
                                currency: balance.currency,
                              }}
                            />
                          ) : (
                            '—'
                          )}
                        </strong>
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </AnimatedItem>
            );
          })}
        </AnimatedGrid>
      ) : balances.data ? (
        <Card>
          <EmptyState
            action={
              <Button asChild icon={Plus}>
                <Link to="/expenses/new">Add the first expense</Link>
              </Button>
            }
            description="Once an expense is posted, its currency-specific balance will appear here."
            icon={CircleCheck}
            title="Everything is balanced"
          />
        </Card>
      ) : null}

      <div className="dashboard-grid">
        <Card className="dashboard-groups">
          <CardHeader>
            <div>
              <span className="eyebrow">Shared spaces</span>
              <h2>Your groups</h2>
            </div>
            <Button asChild size="sm" variant="ghost">
              <Link to="/groups">
                View all <ArrowRight aria-hidden="true" size={16} />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {groups.isLoading && <PageSkeleton cards={2} />}
            {groups.error && (
              <ApiErrorPanel error={groups.error} onRetry={() => void groups.refetch()} />
            )}
            {groups.data && groups.data.items.length === 0 && (
              <EmptyState
                action={
                  <Button asChild size="sm">
                    <Link to="/groups">Create a group</Link>
                  </Button>
                }
                description="Trips, homes, and shared activities will stay organized here."
                title="No groups yet"
              />
            )}
            {groups.data && groups.data.items.length > 0 && (
              <div className="compact-groups">
                {groups.data.items.slice(0, 4).map((group) => (
                  <Link className="compact-group" key={group.id} to={`/groups/${group.id}`}>
                    <span aria-hidden="true" className="compact-group__art">
                      <GroupArtwork group={group} />
                    </span>
                    <span>
                      <strong>{group.name}</strong>
                      <small>
                        {group.memberCount ?? '—'} members · {group.defaultCurrency}
                      </small>
                    </span>
                    {group.archived ? (
                      <StatusBadge>Archived</StatusBadge>
                    ) : (
                      <ArrowRight aria-hidden="true" size={17} />
                    )}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="dashboard-focus">
          <CardContent>
            <span className="dashboard-focus__icon">
              <WalletCards aria-hidden="true" />
            </span>
            <span className="eyebrow">A calmer next step</span>
            <h2>Record first. Settle when everyone agrees.</h2>
            <p>
              A manual settlement is an assertion from you, not proof from a bank. SPLITO keeps that
              distinction visible.
            </p>
            <Button asChild variant="secondary">
              <Link to="/settle">Review settlement</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <section>
        <div className="section-heading">
          <div>
            <span className="eyebrow">Shortcuts</span>
            <h2>Keep things moving</h2>
          </div>
        </div>
        <div className="feature-links">
          <FeatureLinkCard
            description="Find an expense by person, category, group, or date."
            icon={Search}
            label="Search expenses"
            to="/search"
          />
          <FeatureLinkCard
            description="Prepare repeating costs and review each occurrence."
            icon={Repeat2}
            label="Recurring expenses"
            to="/recurring"
          />
          <FeatureLinkCard
            description="See uploads and receipt extraction that need review."
            icon={ReceiptText}
            label="Receipt inbox"
            to="/receipts"
          />
          <FeatureLinkCard
            description="Inspect posted changes and synchronization events."
            icon={Clock3}
            label="Activity trail"
            to="/activity"
          />
        </div>
      </section>
    </div>
  );
}

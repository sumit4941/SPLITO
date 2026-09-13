import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, SelectField, StatusBadge } from '@splito/ui';
import { BarChart3, Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import { api } from '../api/client';
import { ApiErrorPanel, PageSkeleton } from '../components/ApiStates';
import { PageIntro } from '../components/PageElements';
import { formatMinor } from '../lib/money';
import type { CategorySpend } from '../types';

const chartColors = ['#7657ef', '#19b8d1', '#f8757e', '#f1ae3e', '#1eb980', '#a78bfa'];

function isChartDatum(value: unknown): value is { amountMinor: string; category: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'amountMinor' in value &&
    typeof value.amountMinor === 'string' &&
    'category' in value &&
    typeof value.category === 'string'
  );
}

function CategoryChart({ currency, rows }: { currency: string; rows: CategorySpend[] }) {
  const chartData = rows.map((row) => ({
    ...row,
    visualAmount: Number(BigInt(row.amountMinor)),
  }));
  const tooltip = ({ active, payload }: TooltipContentProps) => {
    const datum: unknown = payload?.[0]?.payload;
    return active && isChartDatum(datum) ? (
      <div className="chart-tooltip">
        <strong>{datum.category}</strong>
        <span>{formatMinor(datum.amountMinor, currency)}</span>
      </div>
    ) : null;
  };
  return (
    <div className="analytics-chart-block">
      <div aria-hidden="true" className="analytics-chart">
        <ResponsiveContainer height="100%" width="100%">
          <BarChart data={chartData} margin={{ bottom: 4, left: 0, right: 8, top: 16 }}>
            <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="4 6" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="category"
              tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              tickFormatter={(value) =>
                Intl.NumberFormat(undefined, { notation: 'compact' }).format(Number(value))
              }
              tickLine={false}
            />
            <Tooltip content={tooltip} cursor={{ fill: 'var(--surface-muted)' }} />
            <Bar animationDuration={650} dataKey="visualAmount" radius={[8, 8, 3, 3]}>
              {chartData.map((row, index) => (
                <Cell fill={chartColors[index % chartColors.length]} key={row.category} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="data-table">
        <caption>Accessible table alternative: spending by category in {currency}</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Expenses</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.category}>
              <th scope="row">{row.category}</th>
              <td>{row.expenseCount ?? '—'}</td>
              <td>{formatMinor(row.amountMinor, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AnalyticsPage() {
  const [period, setPeriod] = useState('month');
  const [groupId, setGroupId] = useState('');
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.groups() });
  const analytics = useQuery({
    queryKey: ['analytics', period, groupId],
    queryFn: () => api.analytics(period, groupId || undefined),
  });
  const currencyGroups = useMemo(() => {
    const result = new Map<string, CategorySpend[]>();
    analytics.data?.categories.forEach((row) =>
      result.set(row.currency, [...(result.get(row.currency) ?? []), row]),
    );
    return [...result.entries()];
  }, [analytics.data]);

  return (
    <div className="page-stack">
      <PageIntro
        eyebrow="Posted expenses only"
        title="Spending, with the basis visible"
        description="Settlements are transfers, refunds reduce spending, and currencies are never silently combined."
      />
      <Card className="analytics-filters">
        <CardContent>
          <SelectField
            label="Period"
            onChange={(event) => setPeriod(event.target.value)}
            value={period}
          >
            <option value="month">This month</option>
            <option value="quarter">This quarter</option>
            <option value="year">This year</option>
            <option value="all">All time</option>
          </SelectField>
          <SelectField
            label="Group"
            onChange={(event) => setGroupId(event.target.value)}
            value={groupId}
          >
            <option value="">All authorized groups</option>
            {groups.data?.items.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </SelectField>
        </CardContent>
      </Card>
      {analytics.isLoading && <PageSkeleton cards={3} />}
      {analytics.error && (
        <ApiErrorPanel error={analytics.error} onRetry={() => void analytics.refetch()} />
      )}
      {analytics.data && analytics.data.categories.length === 0 && (
        <Card>
          <CardContent>
            <div className="inline-empty">
              <BarChart3 aria-hidden="true" />
              <p>No posted spending matches this period and group filter.</p>
            </div>
          </CardContent>
        </Card>
      )}
      {analytics.data &&
        currencyGroups.map(([currency, rows]) => (
          <Card key={currency}>
            <CardHeader>
              <div>
                <span className="eyebrow">{analytics.data?.periodLabel ?? period}</span>
                <h2>Spending by category · {currency}</h2>
              </div>
              <StatusBadge tone="info">Original currency</StatusBadge>
            </CardHeader>
            <CardContent>
              <CategoryChart currency={currency} rows={rows} />
            </CardContent>
          </Card>
        ))}
      {analytics.data?.conversionBasis && (
        <p className="analytics-basis">
          <Info aria-hidden="true" size={16} />
          Converted display basis: {analytics.data.conversionBasis}
        </p>
      )}
    </div>
  );
}

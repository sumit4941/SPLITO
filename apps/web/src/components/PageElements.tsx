import { Button, Card, CardContent, StatusBadge, cn } from '@splito/ui';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  CircleDollarSign,
  type LucideIcon,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { compareMinor, formatMinor } from '../lib/money';
import { useTheme } from '../providers/ThemeProvider';
import type { ExpenseSummary, GroupSummary, MoneyValue, Participant } from '../types';

export function PageIntro({
  actions,
  eyebrow,
  title,
  description,
}: {
  actions?: ReactNode;
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="page-intro">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-intro__actions">{actions}</div>}
    </div>
  );
}

export function AnimatedGrid({ children, className }: { children: ReactNode; className?: string }) {
  const systemReduced = useReducedMotion();
  const { reducedMotion } = useTheme();
  return (
    <motion.div
      animate="show"
      className={className}
      initial="hidden"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: systemReduced || reducedMotion ? 0 : 0.055 } },
      }}
    >
      {children}
    </motion.div>
  );
}

export function AnimatedItem({ children, className }: { children: ReactNode; className?: string }) {
  const systemReduced = useReducedMotion();
  const { reducedMotion } = useTheme();
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: systemReduced || reducedMotion ? 0 : 12 },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration: systemReduced || reducedMotion ? 0 : 0.32 },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

export function MoneyAmount({
  amount,
  locale,
  showSign = false,
}: {
  amount: MoneyValue;
  locale?: string;
  showSign?: boolean;
}) {
  const direction = compareMinor(amount.amountMinor);
  const tone = direction > 0 ? 'positive' : direction < 0 ? 'negative' : 'neutral';
  const Icon = direction > 0 ? ArrowDownLeft : direction < 0 ? ArrowUpRight : CircleDollarSign;
  return (
    <span className={cn('money-amount', `money-amount--${tone}`)}>
      <Icon aria-hidden="true" size={16} />
      <span className="sr-only">
        {direction > 0 ? 'You are owed' : direction < 0 ? 'You owe' : 'Settled'}:{' '}
      </span>
      <span>
        {showSign && direction > 0 ? '+' : ''}
        {formatMinor(amount.amountMinor, amount.currency, locale)}
      </span>
    </span>
  );
}

export function Avatar({
  participant,
  size = 'md',
}: {
  participant: Pick<Participant, 'displayName' | 'avatarUrl'>;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const initial = participant.displayName.trim().slice(0, 1).toUpperCase() || '?';
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [participant.avatarUrl]);
  return participant.avatarUrl && !imageFailed ? (
    <img
      alt=""
      className={cn('avatar', `avatar--${size}`)}
      onError={() => setImageFailed(true)}
      src={participant.avatarUrl}
    />
  ) : (
    <span aria-hidden="true" className={cn('avatar', 'avatar--fallback', `avatar--${size}`)}>
      {initial}
    </span>
  );
}

export function GroupArtwork({ group }: { group: Pick<GroupSummary, 'imageUrl' | 'name'> }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [group.imageUrl]);
  return group.imageUrl && !imageFailed ? (
    <img alt="" onError={() => setImageFailed(true)} src={group.imageUrl} />
  ) : (
    <span aria-hidden="true">{group.name.trim().slice(0, 2).toUpperCase() || '?'}</span>
  );
}

export function ExpenseList({ expenses }: { expenses: ExpenseSummary[] }) {
  return (
    <div className="expense-list">
      {expenses.map((expense) => (
        <Link className="expense-row" key={expense.id} to={`/expenses/${expense.id}`}>
          <span aria-hidden="true" className="expense-row__category">
            {categoryGlyph(expense.category)}
          </span>
          <span className="expense-row__main">
            <strong>{expense.description}</strong>
            <small>
              {new Intl.DateTimeFormat(undefined, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              }).format(new Date(expense.expenseDate))}
              {expense.groupName ? ` · ${expense.groupName}` : ''}
            </small>
          </span>
          <span className="expense-row__amount">
            <strong>{formatMinor(expense.amount.amountMinor, expense.amount.currency)}</strong>
            {expense.myShare && (
              <small>
                Your share {formatMinor(expense.myShare.amountMinor, expense.myShare.currency)}
              </small>
            )}
          </span>
          <StatusBadge
            tone={
              expense.status === 'voided'
                ? 'negative'
                : expense.status === 'draft'
                  ? 'warning'
                  : 'neutral'
            }
          >
            {expense.status ?? 'posted'}
          </StatusBadge>
          <ChevronRight aria-hidden="true" className="expense-row__chevron" size={18} />
        </Link>
      ))}
    </div>
  );
}

function categoryGlyph(category?: string) {
  const key = category?.toLowerCase() ?? '';
  if (key.includes('food') || key.includes('dining')) return '🍜';
  if (key.includes('travel') || key.includes('transport')) return '✈️';
  if (key.includes('home') || key.includes('rent')) return '🏠';
  if (key.includes('shop')) return '🛍️';
  if (key.includes('utility')) return '💡';
  return '◌';
}

export function FeatureLinkCard({
  description,
  icon: Icon,
  label,
  to,
}: {
  description: string;
  icon: LucideIcon;
  label: string;
  to: string;
}) {
  return (
    <Card className="feature-link-card">
      <CardContent>
        <span className="feature-link-card__icon">
          <Icon aria-hidden="true" size={20} />
        </span>
        <div>
          <strong>{label}</strong>
          <p>{description}</p>
        </div>
        <Button asChild aria-label={`Open ${label}`} size="icon" variant="ghost">
          <Link to={to}>
            <ChevronRight aria-hidden="true" size={19} />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

import { Button, EmptyState, ErrorState, Skeleton } from '@splito/ui';
import { LogIn, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ApiError, friendlyApiError } from '../api/client';

export function PageSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div aria-label="Loading page" className="page-skeleton" role="status">
      <span className="sr-only">Loading</span>
      <Skeleton className="page-skeleton__title" />
      <div className="page-skeleton__grid">
        {Array.from({ length: cards }, (_, index) => (
          <Skeleton className="page-skeleton__card" key={index} />
        ))}
      </div>
    </div>
  );
}

export function ApiErrorPanel({
  error,
  onRetry,
  title,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const unauthorized = error instanceof ApiError && error.status === 401;
  return (
    <ErrorState
      action={
        unauthorized ? (
          <Button asChild size="sm">
            <Link to="/login">
              <LogIn aria-hidden="true" size={17} />
              Sign in
            </Link>
          </Button>
        ) : onRetry ? (
          <Button onClick={onRetry} size="sm" variant="secondary">
            <RefreshCw aria-hidden="true" size={16} />
            Try again
          </Button>
        ) : undefined
      }
      description={friendlyApiError(error)}
      title={title ?? (unauthorized ? 'Sign in required' : "We couldn't load this view")}
    />
  );
}

export function HonestEmpty({
  action,
  description,
  title,
}: {
  action?: React.ReactNode;
  description: string;
  title: string;
}) {
  return <EmptyState action={action} description={description} title={title} />;
}

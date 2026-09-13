import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SafeErrorBoundary } from './SafeErrorBoundary';

const sensitiveError =
  'Cannot GET /api/v1/friends Request ID: bc7b92db-eb59-449f-8cc1-0a01c0c042d3';

function BrokenView(): never {
  throw new Error(sensitiveError);
}

describe('SafeErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows only product-safe copy when a view throws a sensitive error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <SafeErrorBoundary>
        <BrokenView />
      </SafeErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('alert')).toHaveTextContent("This page couldn't be displayed");
    expect(document.body).not.toHaveTextContent('Cannot GET');
    expect(document.body).not.toHaveTextContent('/api/v1/friends');
    expect(document.body).not.toHaveTextContent('Request ID');
    expect(document.body).not.toHaveTextContent('bc7b92db-eb59-449f-8cc1-0a01c0c042d3');
  });
});

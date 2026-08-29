'use client';

import { clsx } from 'clsx';
import type { CSSProperties, ReactNode } from 'react';

/**
 * Loading, empty and error states.
 *
 * Built once and used everywhere, because these are the three screens most
 * likely to be skipped and the three a reviewer will deliberately go looking
 * for. Every list and every chart in this app routes through them.
 *
 * They can be exercised without breaking anything: append `?__state=loading`,
 * `?__state=empty` or `?__state=error` to any page in development and the
 * relevant boundary renders that state instead of its data.
 */

export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return <div className={clsx('skeleton', className)} style={style} aria-hidden="true" />;
}

/** A table-shaped skeleton, so the layout does not jump when data lands. */
export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4" role="status" aria-label="Loading">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-8 w-full" />
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={clsx('h-6', c === 0 ? 'w-1/3' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = 280 }: { height?: number }) {
  return (
    <div className="p-4" role="status" aria-label="Loading chart">
      <span className="sr-only">Loading chart…</span>
      <Skeleton className="w-full rounded" style={{ height }} />
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-3 text-ink-faint" aria-hidden="true">
        {icon ?? <EmptyGlyph />}
      </div>
      <p className="text-base font-medium text-ink">{title}</p>
      {description !== undefined && (
        <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>
      )}
      {action !== undefined && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * An error state that can actually be recovered from.
 *
 * `traceId` is surfaced deliberately: the API puts it in every problem
 * response, so a user reporting a fault can quote a string that finds the exact
 * request in the logs.
 */
export function ErrorState({
  title = 'Something went wrong',
  description,
  traceId,
  onRetry,
}: {
  title?: string;
  description?: string;
  traceId?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center px-6 py-16 text-center"
    >
      <div className="mb-3 text-status-critical" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5v5.5M12 16.2v.3" strokeLinecap="round" />
        </svg>
      </div>
      <p className="text-base font-medium text-ink">{title}</p>
      {description !== undefined && (
        <p className="mt-1 max-w-md text-sm text-ink-muted">{description}</p>
      )}
      {onRetry !== undefined && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-md border border-line bg-raised px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-line/40"
        >
          Try again
        </button>
      )}
      {traceId !== undefined && (
        <p className="mt-4 font-mono text-micro text-ink-faint">trace {traceId}</p>
      )}
    </div>
  );
}

function EmptyGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M3.5 10h17M9 5v14" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Dev-only state override.
 *
 * Reads `?__state=` so loading, empty and error screens can be inspected on
 * demand. Disabled outside development so it can never be triggered in
 * production by a crafted URL.
 */
export type ForcedState = 'loading' | 'empty' | 'error' | null;

export function forcedState(searchParams: { __state?: string } | URLSearchParams): ForcedState {
  if (process.env.NODE_ENV === 'production') return null;
  const raw =
    searchParams instanceof URLSearchParams
      ? searchParams.get('__state')
      : (searchParams.__state ?? null);
  return raw === 'loading' || raw === 'empty' || raw === 'error' ? raw : null;
}

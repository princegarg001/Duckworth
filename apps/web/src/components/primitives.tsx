import Link from 'next/link';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';

/** Shared layout and display primitives. */

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow !== undefined && (
          <p className="mb-1 text-micro font-medium uppercase tracking-wider text-ink-faint">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle !== undefined && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions !== undefined && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * A single headline number.
 *
 * When the job is one value, a chart is the wrong form — a stat tile reads
 * faster and takes less space than any plot of a single datum.
 */
export function StatTile({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-micro font-medium uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-1.5 text-xl font-semibold tracking-tight text-ink">{value}</p>
      {hint !== undefined && <p className="mt-0.5 truncate text-xs text-ink-muted">{hint}</p>}
    </>
  );

  return href === undefined ? (
    <div className="card px-4 py-3.5">{body}</div>
  ) : (
    <Link href={href} className="card block px-4 py-3.5 transition-colors hover:bg-raised">
      {body}
    </Link>
  );
}

export function Card({
  title,
  description,
  action,
  children,
  padded = true,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className="card">
      {title !== undefined && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
            {description !== undefined && (
              <p className="mt-0.5 text-xs text-ink-muted">{description}</p>
            )}
          </div>
          {action}
        </header>
      )}
      <div className={clsx(padded && 'p-4')}>{children}</div>
    </section>
  );
}

export function TeamBadge({
  shortName,
  name,
  size = 'md',
}: {
  shortName: string;
  name?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className={clsx(
          'grid shrink-0 place-items-center rounded bg-ink/8 font-semibold text-ink-muted',
          size === 'sm' ? 'h-5 w-9 text-[10px]' : 'h-6 w-10 text-[11px]',
        )}
      >
        {shortName}
      </span>
      {name !== undefined && <span className="truncate">{name}</span>}
    </span>
  );
}

/** A signed number where the sign carries meaning — net run rate, margins. */
export function Signed({ value, digits = 3 }: { value: number; digits?: number }) {
  const positive = value > 0;
  return (
    <span
      className={clsx(
        'font-medium',
        positive ? 'text-status-good' : value < 0 ? 'text-status-critical' : 'text-ink-muted',
      )}
    >
      {positive ? '+' : ''}
      {value.toFixed(digits)}
    </span>
  );
}

/** Renders a nullable rate as an em dash rather than "null" or "NaN". */
export function Rate({ value, digits = 2 }: { value: number | null; digits?: number }) {
  return value === null ? (
    <span className="text-ink-faint">—</span>
  ) : (
    <>{value.toFixed(digits)}</>
  );
}

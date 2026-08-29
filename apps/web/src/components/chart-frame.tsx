'use client';

import { useId, useState, type ReactNode } from 'react';

import { EmptyState } from './states';

/**
 * The frame every chart sits in.
 *
 * It supplies three things that are easy to leave out and expensive to retrofit:
 *
 * 1. **A table view.** Every chart has a "Table" toggle rendering the same
 *    numbers as a real `<table>`. This is the accessibility path for anyone not
 *    reading the shapes, and it is also the relief mechanism the palette
 *    requires for the one series colour that sits under 3:1 on the light
 *    surface — the values are always available as text.
 * 2. **An empty state.** A filter that matches nothing renders a message, not a
 *    blank box with axes.
 * 3. **A caption.** What the chart is measuring, in words, above the marks.
 */

export interface ChartFrameProps {
  title: string;
  description?: string;
  /** Rendered when `isEmpty`; defaults to a generic message. */
  emptyTitle?: string;
  emptyDescription?: string;
  isEmpty?: boolean;
  /** The chart itself. */
  children: ReactNode;
  /** The same data as a table. Required — a chart without one is not finished. */
  table: ReactNode;
  /** Legend entries; rendered above the plot. Omitted for a single series. */
  legend?: { label: string; color: string }[];
  action?: ReactNode;
}

export function ChartFrame({
  title,
  description,
  emptyTitle,
  emptyDescription,
  isEmpty = false,
  children,
  table,
  legend,
  action,
}: ChartFrameProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const panelId = useId();

  return (
    <section className="card" aria-labelledby={`${panelId}-title`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h3 id={`${panelId}-title`} className="text-sm font-semibold text-ink">
            {title}
          </h3>
          {description !== undefined && (
            <p className="mt-0.5 text-xs text-ink-muted">{description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {action}
          <div
            role="group"
            aria-label="View as"
            className="flex rounded-md border border-line p-0.5"
          >
            {(['chart', 'table'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={
                  view === v
                    ? 'rounded px-2 py-1 text-xs font-medium bg-ink/10 text-ink capitalize'
                    : 'rounded px-2 py-1 text-xs font-medium text-ink-muted hover:text-ink capitalize'
                }
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </header>

      {legend !== undefined && legend.length > 1 && view === 'chart' && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-3">
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5 text-xs text-ink-muted">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: l.color }}
              />
              {l.label}
            </li>
          ))}
        </ul>
      )}

      <div id={panelId}>
        {isEmpty ? (
          <EmptyState
            title={emptyTitle ?? 'Nothing to show'}
            description={emptyDescription ?? 'No data matches the current selection.'}
          />
        ) : view === 'chart' ? (
          <div className="p-4 animate-fade-in">{children}</div>
        ) : (
          <div className="scroll-x animate-fade-in">{table}</div>
        )}
      </div>
    </section>
  );
}

/** Shared table styling, so every table view looks like the same product. */
export function DataTable({
  headers,
  children,
  caption,
}: {
  headers: readonly string[];
  children: ReactNode;
  caption?: string;
}) {
  return (
    <table className="w-full border-collapse text-sm">
      {caption !== undefined && <caption className="sr-only">{caption}</caption>}
      <thead>
        <tr className="border-b border-line">
          {headers.map((h, i) => (
            <th
              key={h}
              scope="col"
              className={
                i === 0
                  ? 'px-4 py-2 text-left text-xs font-medium text-ink-muted whitespace-nowrap'
                  : 'px-4 py-2 text-right text-xs font-medium text-ink-muted whitespace-nowrap'
              }
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

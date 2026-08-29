'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { clsx } from 'clsx';
import { useCallback, useRef, useState } from 'react';

import { api, unwrap } from '../lib/api';
import { EmptyState, ErrorState, Skeleton } from './states';

/**
 * Virtualised ball-by-ball list with cursor pagination.
 *
 * Rows are windowed by `@tanstack/react-virtual`, so the DOM holds ~20 nodes
 * regardless of how many deliveries have been loaded. The next page is fetched
 * when the viewport approaches the end of what is loaded, using the opaque
 * cursor the API returned — the client never constructs one.
 */

interface PlayerRef {
  id: number;
  shortName: string;
  fullName: string;
}

export interface DeliveryRow {
  id: number;
  deliverySeq: number;
  inningsId: number;
  over: number;
  ballInOver: number;
  striker: PlayerRef;
  nonStriker: PlayerRef;
  bowler: PlayerRef;
  batRuns: number;
  extraRuns: number;
  totalRuns: number;
  isFour: boolean;
  isSix: boolean;
  isWide: boolean;
  isNoball: boolean;
  isLegalBall: boolean;
  wicket: { kind: string; playerOut: PlayerRef; howOut: string | null } | null;
  commentary: string | null;
}

export function DeliveryList({
  matchId,
  initial,
  initialCursor,
  innings,
}: {
  matchId: number;
  initial: DeliveryRow[];
  initialCursor: string | null;
  innings: { inningsNo: number; label: string }[];
}) {
  const [rows, setRows] = useState<DeliveryRow[]>(initial);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (cursor === null || loading) return;
    setLoading(true);
    setError(null);
    try {
      const next = await api
        .GET('/v1/matches/{id}/deliveries', {
          params: { path: { id: matchId }, query: { limit: 100, cursor } },
        })
        .then(unwrap);
      setRows((prev) => [...prev, ...(next.data as DeliveryRow[])]);
      setCursor(next.page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load more deliveries.');
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, matchId]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 12,
  });

  const items = virtualizer.getVirtualItems();
  const last = items[items.length - 1];
  // Prefetch when the window gets within 20 rows of the end.
  if (last !== undefined && last.index >= rows.length - 20 && cursor !== null && !loading) {
    void loadMore();
  }

  if (rows.length === 0) {
    return (
      <div className="card">
        <EmptyState
          title="No deliveries recorded"
          description="This match has no ball-by-ball detail."
        />
      </div>
    );
  }

  const labelFor = (row: DeliveryRow) => {
    const idx = innings.findIndex((_, i) => i === inningsIndex(rows, row));
    return innings[idx]?.label ?? '';
  };

  return (
    <div className="card overflow-hidden">
      <div
        ref={parentRef}
        className="max-h-[70vh] overflow-y-auto"
        role="log"
        aria-label="Ball by ball commentary"
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {items.map((v) => {
            const d = rows[v.index];
            if (d === undefined) return null;
            return (
              <div
                key={d.id}
                data-index={v.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${v.start}px)`,
                }}
                className="border-b border-line/60 px-4 py-2.5"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 w-12 shrink-0 font-mono text-xs text-ink-faint">
                    {d.over}.{d.ballInOver}
                  </span>
                  <Outcome d={d} />
                  <p className="min-w-0 flex-1 text-sm text-ink-muted">
                    <span className="text-ink">{d.bowler.shortName}</span>
                    <span className="text-ink-faint"> to </span>
                    <span className="text-ink">{d.striker.shortName}</span>
                    {d.wicket !== null && (
                      <span className="ml-1.5 font-medium text-status-critical">
                        — {d.wicket.howOut ?? d.wicket.kind.replace(/_/g, ' ')}
                      </span>
                    )}
                    {d.commentary !== null && d.commentary !== '' && (
                      <span className="mt-0.5 block truncate text-xs text-ink-faint">
                        {d.commentary}
                      </span>
                    )}
                  </p>
                  <span className="sr-only">{labelFor(d)}</span>
                </div>
              </div>
            );
          })}
        </div>

        {loading && (
          <div className="space-y-2 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5" />
          </div>
        )}
      </div>

      {error !== null && (
        <ErrorState
          title="Could not load more"
          description={error}
          onRetry={() => {
            void loadMore();
          }}
        />
      )}

      <p className="border-t border-line px-4 py-2 text-xs text-ink-faint">
        {rows.length} deliveries loaded{cursor === null ? ' · complete' : ' · scroll for more'}
      </p>
    </div>
  );
}

/** Index of the innings a delivery belongs to, by first appearance order. */
function inningsIndex(rows: readonly DeliveryRow[], row: DeliveryRow): number {
  const ids: number[] = [];
  for (const r of rows) {
    if (!ids.includes(r.inningsId)) ids.push(r.inningsId);
    if (r.inningsId === row.inningsId) break;
  }
  return ids.indexOf(row.inningsId);
}

/**
 * The outcome chip.
 *
 * Boundaries and wickets are the two things a reader scans for, so they get a
 * distinct fill; everything else stays recessive. Colour is never the only
 * signal — the number and the "W" are the label.
 */
function Outcome({ d }: { d: DeliveryRow }) {
  const label = d.wicket !== null ? 'W' : String(d.totalRuns);
  const extra = d.isWide ? 'wd' : d.isNoball ? 'nb' : null;

  return (
    <span className="flex shrink-0 items-center gap-1">
      <span
        className={clsx(
          'grid h-6 w-6 place-items-center rounded text-xs font-semibold',
          d.wicket !== null
            ? 'bg-status-critical/15 text-status-critical'
            : d.isSix
              ? 'bg-series-2/20 text-series-2'
              : d.isFour
                ? 'bg-series-1/15 text-series-1'
                : 'bg-ink/6 text-ink-muted',
        )}
      >
        {label}
      </span>
      {extra !== null && <span className="text-[10px] text-ink-faint">{extra}</span>}
    </span>
  );
}

'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

/**
 * Filters, in one row above the content.
 *
 * Each control writes to the query string and lets the server re-render. That
 * keeps the URL authoritative — a filtered view can be shared or bookmarked and
 * the back button steps through filter changes — and means there is no
 * client-side copy of the filter state to fall out of sync with the address bar.
 *
 * `useTransition` keeps the current results on screen while the next render is
 * in flight, so changing a filter dims rather than blanks the page.
 */
export function MatchFilters({
  teams,
  venues,
}: {
  teams: { id: number; name: string; shortName: string }[];
  venues: { id: number; name: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const set = (key: string, value: string) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (value === '') sp.delete(key);
    else sp.set(key, value);
    // A filter change invalidates the page position.
    sp.delete('cursor');
    startTransition(() => {
      router.push(sp.size === 0 ? '/matches' : `/matches?${sp.toString()}`);
    });
  };

  const active = ['teamId', 'venueId', 'stage'].filter((k) => searchParams.get(k) !== null);

  return (
    <div
      className="flex flex-wrap items-end gap-3"
      style={{ opacity: pending ? 0.6 : 1, transition: 'opacity 120ms' }}
    >
      <Select
        label="Team"
        value={searchParams.get('teamId') ?? ''}
        onChange={(v) => set('teamId', v)}
        options={[
          { value: '', label: 'All teams' },
          ...teams.map((t) => ({ value: String(t.id), label: t.name })),
        ]}
      />
      <Select
        label="Venue"
        value={searchParams.get('venueId') ?? ''}
        onChange={(v) => set('venueId', v)}
        options={[
          { value: '', label: 'All venues' },
          ...venues.map((v) => ({ value: String(v.id), label: v.name })),
        ]}
      />
      <Select
        label="Stage"
        value={searchParams.get('stage') ?? ''}
        onChange={(v) => set('stage', v)}
        options={[
          { value: '', label: 'All stages' },
          { value: 'league', label: 'League' },
          { value: 'qualifier1', label: 'Qualifier 1' },
          { value: 'eliminator', label: 'Eliminator' },
          { value: 'qualifier2', label: 'Qualifier 2' },
          { value: 'final', label: 'Final' },
        ]}
      />

      {active.length > 0 && (
        <button
          type="button"
          onClick={() =>
            startTransition(() => {
              router.push('/matches');
            })
          }
          className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-raised hover:text-ink"
        >
          Clear
        </button>
      )}

      <span aria-live="polite" className="sr-only">
        {pending ? 'Updating results' : ''}
      </span>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-micro font-medium uppercase tracking-wider text-ink-faint">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-[9rem] rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

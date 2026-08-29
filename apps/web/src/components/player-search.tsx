'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

/**
 * Debounced search that writes to the URL.
 *
 * The input is locally controlled so typing stays responsive, but the query
 * string is the source of truth — a search result is shareable, and reloading
 * the page keeps the search. 300ms of debounce is enough to avoid a request per
 * keystroke without feeling laggy.
 */
export function PlayerSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const urlQuery = searchParams.get('q') ?? '';
  const [value, setValue] = useState(urlQuery);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the field in step when navigation changes the URL (back button,
  // "clear search"), without clobbering what the user is mid-way through typing.
  useEffect(() => {
    setValue(urlQuery);
  }, [urlQuery]);

  const push = (next: string) => {
    const sp = new URLSearchParams();
    if (next.trim() !== '') sp.set('q', next.trim());
    startTransition(() => {
      router.push(sp.size === 0 ? '/players' : `/players?${sp.toString()}`);
    });
  };

  const onChange = (next: string) => {
    setValue(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => push(next), 300);
  };

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (timer.current !== null) clearTimeout(timer.current);
        push(value);
      }}
      className="flex items-end gap-2"
      style={{ opacity: pending ? 0.6 : 1, transition: 'opacity 120ms' }}
    >
      <label className="flex flex-1 flex-col gap-1 sm:max-w-xs">
        <span className="text-micro font-medium uppercase tracking-wider text-ink-faint">
          Search
        </span>
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Player name"
          className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint"
        />
      </label>
      <span aria-live="polite" className="sr-only">
        {pending ? 'Searching' : ''}
      </span>
    </form>
  );
}

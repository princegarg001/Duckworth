'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';

const LINKS = [
  { href: '/', label: 'Overview' },
  { href: '/matches', label: 'Matches' },
  { href: '/teams', label: 'Teams' },
  { href: '/players', label: 'Players' },
  { href: '/venues', label: 'Venues' },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-page/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 py-3.5">
          <span
            aria-hidden="true"
            className="grid h-6 w-6 place-items-center rounded bg-accent text-[11px] font-bold text-white"
          >
            21
          </span>
          <span className="text-sm font-semibold tracking-tight">IPL 2022</span>
        </Link>

        <nav aria-label="Primary" className="scroll-x -mb-px flex-1">
          <ul className="flex gap-1">
            {LINKS.map((l) => {
              const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    aria-current={active ? 'page' : undefined}
                    className={clsx(
                      'inline-block whitespace-nowrap border-b-2 px-3 py-3.5 text-sm transition-colors',
                      active
                        ? 'border-accent font-medium text-ink'
                        : 'border-transparent text-ink-muted hover:text-ink',
                    )}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}

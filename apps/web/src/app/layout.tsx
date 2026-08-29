import type { Metadata, Viewport } from 'next';

import { Nav } from '../components/nav';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'IPL Data Platform',
    template: '%s · IPL Data Platform',
  },
  description:
    'Ball-by-ball IPL 2022 analytics: scorecards, points table, player records and phase splits, derived from 17,912 deliveries.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f9f9f7' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0d0d' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        {/* The first thing a keyboard user meets. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-raised focus:px-3 focus:py-2 focus:text-sm focus:shadow-card"
        >
          Skip to content
        </a>
        <Nav />
        <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
          {children}
        </main>
        <footer className="mx-auto w-full max-w-6xl px-4 pb-10 pt-4 sm:px-6">
          <p className="border-t border-line pt-4 text-xs text-ink-faint">
            Every figure is derived from ball-by-ball deliveries and reconciled against the
            published scorecards by 23 data-quality checks.{' '}
            <a className="underline hover:text-ink-muted" href="/api/docs">
              API documentation
            </a>
          </p>
        </footer>
      </body>
    </html>
  );
}

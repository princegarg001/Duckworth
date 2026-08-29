'use client';

import { useEffect } from 'react';

import { ErrorState } from '../components/states';

/**
 * Route-segment error boundary.
 *
 * Next.js renders this instead of the page when a server component throws, so
 * a failed API call becomes a recoverable screen rather than a blank one.
 * `reset()` re-runs the segment, which is a real retry, not a page reload.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <div className="card">
      <ErrorState
        title="This page could not load"
        description="The API did not return what this page needs. It may be starting up, or the request may have failed."
        traceId={error.digest}
        onRetry={reset}
      />
    </div>
  );
}

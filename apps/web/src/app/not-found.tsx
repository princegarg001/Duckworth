import Link from 'next/link';

import { EmptyState } from '../components/states';

export default function NotFound() {
  return (
    <div className="card">
      <EmptyState
        title="Not found"
        description="That page does not exist, or the record it points to is not in this season."
        action={
          <Link
            href="/"
            className="rounded-md border border-line bg-raised px-3 py-1.5 text-sm font-medium hover:bg-line/40"
          >
            Back to overview
          </Link>
        }
      />
    </div>
  );
}

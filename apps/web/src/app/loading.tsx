import { TableSkeleton } from '../components/states';

export default function Loading() {
  return (
    <div className="card">
      <TableSkeleton rows={10} cols={6} />
    </div>
  );
}

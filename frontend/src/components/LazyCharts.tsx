import { lazy, Suspense, type ComponentProps } from 'react';
import { Skeleton } from '@/components/ui/misc';

// Recharts is the largest dependency; load it only when a chart is actually shown.
const Results = lazy(() => import('./PollResultsChart').then((m) => ({ default: m.PollResultsChart })));
const Participation = lazy(() => import('./ParticipationChart').then((m) => ({ default: m.ParticipationChart })));

const fallback = <div role="status" aria-label="Loading chart"><Skeleton className="h-40 w-full" /></div>;

export function PollResultsChart(props: ComponentProps<typeof Results>) {
  return <Suspense fallback={fallback}><Results {...props} /></Suspense>;
}
export function ParticipationChart(props: ComponentProps<typeof Participation>) {
  return <Suspense fallback={fallback}><Participation {...props} /></Suspense>;
}

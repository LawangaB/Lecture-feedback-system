import { Link, useParams } from 'react-router-dom';
import { ErrorState, LoadingBlock, PageHeader, SessionStatusBadge } from '@/components/states';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { ControlRoom } from './ControlRoom';
import { StudentLive } from './StudentLive';
import { useLiveSession } from './useLiveSession';

export function SessionPage() {
  const { sessionId = '' } = useParams();
  const { snapshot, isLoading, error, refetch, connection, clockOffset } = useLiveSession(sessionId);
  if (isLoading) return <LoadingBlock />;
  if (error || !snapshot) {
    const missing = error instanceof ApiError && error.status === 404;
    return <ErrorState error={missing ? new ApiError(404, 'NOT_FOUND', 'This session does not exist, or you do not have access to it.') : error} onRetry={missing ? undefined : () => refetch()} title={missing ? 'Session not available' : 'We could not load this session'} />;
  }
  if (snapshot.access === 'LECTURER') return <ControlRoom snapshot={snapshot} connection={connection} clockOffset={clockOffset} />;
  if (snapshot.access === 'STUDENT') return <StudentLive snapshot={snapshot} connection={connection} clockOffset={clockOffset} />;
  return (
    <>
      <PageHeader eyebrow={`${snapshot.session.course.code} · ${snapshot.session.course.title}`} title={snapshot.session.title} description={<SessionStatusBadge status={snapshot.session.status} />} />
      <p className="max-w-xl rounded-lg bg-surface-muted p-4 text-sm">Administrators can see that this session exists but cannot view live poll results, feedback or the join code. That keeps participant data limited to the course's lecturers.</p>
      <Button asChild variant="secondary" className="mt-4"><Link to={`/courses/${snapshot.session.course.id}`}>Back to course</Link></Button>
    </>
  );
}

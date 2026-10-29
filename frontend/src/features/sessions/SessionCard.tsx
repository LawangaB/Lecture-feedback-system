import { CalendarClock, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SessionStatusBadge } from '@/components/states';
import { formatDateTime } from '@/lib/utils';
import type { Session } from '@/types/api';

export function SessionCard({ session, showCounts }: { session: Session; showCounts?: boolean }) {
  return (
    <Link to={`/sessions/${session.id}`} className="group relative block overflow-hidden rounded-lg border border-border bg-surface p-4 shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-pop">
      <span className={`absolute inset-x-0 top-0 h-0.5 ${session.status === 'LIVE' ? 'bg-success' : 'bg-gradient-to-r from-primary/70 via-primary/20 to-transparent'}`} aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium group-hover:text-primary">{session.title}</p>
          <p className="truncate text-sm text-muted-foreground">{session.course.code} · {session.course.title}</p>
        </div>
        <SessionStatusBadge status={session.status} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" aria-hidden />{formatDateTime(session.startedAt ?? session.scheduledFor ?? session.createdAt)}</span>
        {showCounts && <span className="tabular inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" aria-hidden />{session.attendanceCount ?? 0} joined · {session.pollCount ?? 0} polls</span>}
      </div>
    </Link>
  );
}

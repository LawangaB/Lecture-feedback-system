import { useQuery } from '@tanstack/react-query';
import { Activity, BarChart3, BookOpen, CheckCircle2, Plus, Radio, RefreshCw, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ParticipationChart } from '@/components/LazyCharts';
import { EmptyState, ErrorState, LoadingBlock, PageHeader, StatCard } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/features/auth/AuthContext';
import { SessionCard } from '@/features/sessions/SessionCard';
import { JoinForm } from '@/features/sessions/JoinPage';
import { api } from '@/lib/api';
import { formatDateTime, formatPercent } from '@/lib/utils';
import type { AuditEvent, Course, Session } from '@/types/api';

type Feed = { live: Session[]; upcoming: Session[]; recent: Session[] };

function DashboardRefresh({ isFetching, updatedAt, onRefresh }: { isFetching: boolean; updatedAt: number; onRefresh: () => void }) {
  const updated = updatedAt ? new Date(updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Just now';
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs text-muted-foreground sm:inline" role="status" aria-live="polite">{isFetching ? 'Updating…' : `Updated ${updated}`}</span>
      <Button variant="secondary" size="icon" onClick={onRefresh} disabled={isFetching} aria-label="Refresh dashboard" title="Refresh dashboard">
        <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} aria-hidden />
      </Button>
    </div>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  if (user?.role === 'LECTURER') return <LecturerDashboard />;
  if (user?.role === 'ADMIN') return <AdminDashboard />;
  return <StudentDashboard />;
}

function StudentDashboard() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ['dashboard', 'student'],
    queryFn: () => api<{ sessions: Feed; pollsAnswered: number; recentFeedback: { sessionId: string; sessionTitle: string; courseCode: string; at: string }[]; courses: { id: string; code: string; title: string; lecturer: string }[] }>('/dashboard/student'),
    refetchInterval: 30_000,
  });
  const history = useQuery({ queryKey: ['participation'], queryFn: () => api<{ items: { pollId: string; question: string; sessionTitle: string; courseCode: string; at: string; isAnonymous: boolean }[] }>('/users/me/participation'), refetchInterval: 60_000 });
  return (
    <>
      <PageHeader title={`Welcome, ${user?.displayName.split(' ')[0]}`} description="Your lectures, participation and feedback in one place." actions={<DashboardRefresh isFetching={q.isFetching || history.isFetching} updatedAt={q.dataUpdatedAt} onRefresh={() => { void Promise.all([q.refetch(), history.refetch()]); }} />} />
      <section className="join-lecture-band mb-7 rounded-lg p-5 shadow-card sm:p-6" aria-labelledby="join-lecture-heading">
        <div className="relative z-10 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.82fr)] lg:items-center">
          <div>
            <p className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase text-white/80"><Activity className="h-3.5 w-3.5" aria-hidden />Quick action</p>
            <h2 id="join-lecture-heading" className="text-xl font-semibold sm:text-2xl">Join a lecture</h2>
            <p className="mt-1 max-w-lg text-sm text-muted-foreground">Enter the session code shown by your lecturer to join the room.</p>
          </div>
          <JoinForm buttonVariant="secondary" />
        </div>
      </section>
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data && (
        <div className="grid gap-6 lg:grid-cols-3">
          <section aria-labelledby="live-h" className="space-y-3 lg:col-span-2">
            <h2 id="live-h" className="font-semibold">Current &amp; upcoming sessions</h2>
            {q.data.sessions.live.length + q.data.sessions.upcoming.length === 0 ? (
              <EmptyState icon={<Radio className="h-5 w-5" aria-hidden />} title="Nothing live right now" description={q.data.courses.length ? 'When a lecturer starts a session in one of your courses it will appear here.' : 'You are not enrolled in any courses yet. Ask your lecturer to add you, or join with a code.'} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">{[...q.data.sessions.live, ...q.data.sessions.upcoming].map((s) => <SessionCard key={s.id} session={s} />)}</div>
            )}
            <h2 className="pt-4 font-semibold">Recent poll participation</h2>
            {history.isLoading ? <LoadingBlock rows={2} /> : (history.data?.items.length ?? 0) === 0 ? (
              <EmptyState icon={<CheckCircle2 className="h-5 w-5" aria-hidden />} title="No polls answered yet" description="Polls you answer during lectures will be listed here." />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
                {history.data!.items.map((h) => (
                  <li key={h.pollId} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0"><p className="truncate font-medium">{h.question}</p><p className="truncate text-muted-foreground">{h.courseCode} · {h.sessionTitle}{h.isAnonymous ? ' · anonymous' : ''}</p></div>
                    <time className="shrink-0 text-xs text-muted-foreground" dateTime={h.at}>{formatDateTime(h.at, { dateStyle: 'medium' })}</time>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <aside className="space-y-6">
            <section aria-labelledby="courses-h">
              <h2 id="courses-h" className="mb-3 font-semibold">Enrolled courses</h2>
              {q.data.courses.length === 0 ? <p className="text-sm text-muted-foreground">No courses yet.</p> : (
                <ul className="space-y-2">{q.data.courses.map((c) => <li key={c.id}><Link to={`/courses/${c.id}`} className="block rounded-md border border-border bg-surface px-3 py-2.5 text-sm hover:border-primary/50"><span className="font-medium">{c.code}</span> · {c.title}<span className="block text-xs text-muted-foreground">{c.lecturer}</span></Link></li>)}</ul>
              )}
            </section>
            <section aria-labelledby="fb-h">
              <h2 id="fb-h" className="mb-3 font-semibold">Recent feedback</h2>
              {q.data.recentFeedback.length === 0 ? <p className="text-sm text-muted-foreground">You haven't sent feedback yet.</p> : (
                <ul className="space-y-2 text-sm">{q.data.recentFeedback.map((f) => <li key={f.sessionId} className="rounded-md bg-surface-muted px-3 py-2">{f.courseCode} · {f.sessionTitle}<time className="block text-xs text-muted-foreground" dateTime={f.at}>{formatDateTime(f.at, { dateStyle: 'medium' })}</time></li>)}</ul>
              )}
              <p className="mt-3 text-xs text-muted-foreground">{q.data.pollsAnswered} {q.data.pollsAnswered === 1 ? 'poll' : 'polls'} answered in total.</p>
            </section>
          </aside>
        </div>
      )}
    </>
  );
}

function LecturerDashboard() {
  const { user } = useAuth();
  const feed = useQuery({ queryKey: ['my-sessions'], queryFn: () => api<Feed>('/sessions'), refetchInterval: 15_000, staleTime: 8_000 });
  const overview = useQuery({
    queryKey: ['lecturer-overview'],
    queryFn: () => api<{ courseCount: number; studentCount: number; averageResponseRate: number | null; trend: { sessionId: string; title: string; courseCode: string; attendance: number; polls: number; responseRate: number | null }[] }>('/analytics/lecturer/overview'),
    refetchInterval: 60_000,
  });
  const trend = (overview.data?.trend ?? []).filter((t) => t.polls > 0 && t.attendance > 0).map((t) => ({ name: t.title.length > 16 ? `${t.title.slice(0, 15)}…` : t.title, rate: Math.round((t.responseRate ?? 0) * 100), full: t.title }));
  const live = feed.data?.live ?? [];
  return (
    <>
      <PageHeader title={`Good to see you, ${user?.displayName.split(' ').slice(0, 2).join(' ')}`} description="Run live polls and see how the room is doing." actions={<><DashboardRefresh isFetching={feed.isFetching || overview.isFetching} updatedAt={feed.dataUpdatedAt} onRefresh={() => { void Promise.all([feed.refetch(), overview.refetch()]); }} /><Button asChild><Link to="/courses"><Plus className="h-4 w-4" aria-hidden />Start or plan a lecture</Link></Button></>} />
      {live.length > 0 && (
        <section aria-labelledby="live-h" className="mb-6 rounded-lg border border-success/40 bg-success-soft p-4">
          <h2 id="live-h" className="mb-3 flex items-center gap-2 font-semibold text-success"><Radio className="h-4 w-4" aria-hidden />Running now</h2>
          <div className="grid gap-3 sm:grid-cols-2">{live.map((s) => <SessionCard key={s.id} session={s} showCounts />)}</div>
        </section>
      )}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Courses" value={overview.data?.courseCount ?? '—'} icon={<BookOpen className="h-4 w-4" aria-hidden />} />
        <StatCard label="Students" value={overview.data?.studentCount ?? '—'} icon={<Users className="h-4 w-4" aria-hidden />} />
        <StatCard label="Avg. response rate" value={formatPercent(overview.data?.averageResponseRate)} hint="Recent sessions with polls" icon={<BarChart3 className="h-4 w-4" aria-hidden />} />
        <StatCard label="Live sessions" value={live.length} icon={<Radio className="h-4 w-4" aria-hidden />} live={live.length > 0} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <section aria-labelledby="up-h" className="space-y-3 lg:col-span-2">
          <h2 id="up-h" className="font-semibold">Upcoming &amp; recent sessions</h2>
          {feed.isLoading ? <LoadingBlock /> : feed.isError ? <ErrorState error={feed.error} onRetry={() => feed.refetch()} /> : (feed.data!.upcoming.length + feed.data!.recent.length === 0 ? (
            <EmptyState title="No sessions yet" description="Create a course, then add a lecture session to start polling." action={<Button asChild variant="soft"><Link to="/courses">Go to courses</Link></Button>} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">{[...feed.data!.upcoming, ...feed.data!.recent].map((s) => <SessionCard key={s.id} session={s} showCounts />)}</div>
          ))}
        </section>
        <Card>
          <CardHeader><CardTitle>Participation by session</CardTitle><CardDescription>Share of joined students who answered, averaged over polls.</CardDescription></CardHeader>
          <CardContent>
            {trend.length === 0 ? <p className="text-sm text-muted-foreground">Run a poll in a session to see participation here.</p> : (
              <ParticipationChart data={trend} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function AdminDashboard() {
  const q = useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => api<{ users: { total: number; students: number; lecturers: number; admins: number; inactive: number }; courses: number; sessions: { total: number; live: number }; recentAudit: (Pick<AuditEvent, 'id' | 'action'> & { actor: string | null; at: string })[] }>('/admin/overview'),
    refetchInterval: 30_000,
  });
  const courses = useQuery({ queryKey: ['courses'], queryFn: () => api<{ items: Course[] }>('/courses'), refetchInterval: 60_000 });
  return (
    <>
      <PageHeader title="System overview" description="Accounts, courses and recent security activity." actions={<><DashboardRefresh isFetching={q.isFetching || courses.isFetching} updatedAt={q.dataUpdatedAt} onRefresh={() => { void Promise.all([q.refetch(), courses.refetch()]); }} /><Button asChild variant="secondary"><Link to="/admin/users">Manage users</Link></Button><Button asChild variant="secondary"><Link to="/admin/audit">Audit log</Link></Button></>} />
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Users" value={q.data.users.total} hint={`${q.data.users.inactive} deactivated`} icon={<Users className="h-4 w-4" aria-hidden />} />
            <StatCard label="Lecturers / students" value={`${q.data.users.lecturers} / ${q.data.users.students}`} hint={`${q.data.users.admins} administrators`} />
            <StatCard label="Courses" value={q.data.courses} icon={<BookOpen className="h-4 w-4" aria-hidden />} />
            <StatCard label="Sessions" value={q.data.sessions.total} hint={`${q.data.sessions.live} live now`} icon={<Radio className="h-4 w-4" aria-hidden />} live={q.data.sessions.live > 0} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
              <CardContent>
                {q.data.recentAudit.length === 0 ? <p className="text-sm text-muted-foreground">No activity recorded yet.</p> : (
                  <ul className="divide-y divide-border text-sm">{q.data.recentAudit.map((a) => <li key={a.id} className="flex justify-between gap-3 py-2"><span className="min-w-0 truncate"><code className="text-xs">{a.action}</code> <span className="text-muted-foreground">· {a.actor ?? 'system'}</span></span><time className="shrink-0 text-xs text-muted-foreground" dateTime={a.at}>{formatDateTime(a.at, { timeStyle: 'short', dateStyle: 'short' })}</time></li>)}</ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Courses</CardTitle></CardHeader>
              <CardContent>
                {courses.isLoading ? <LoadingBlock rows={2} /> : (courses.data?.items.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">No courses yet.</p> : (
                  <ul className="divide-y divide-border text-sm">{courses.data!.items.slice(0, 8).map((c) => <li key={c.id}><Link to={`/courses/${c.id}`} className="flex justify-between gap-3 py-2 hover:text-primary"><span className="truncate">{c.code} · {c.title}</span><span className="tabular shrink-0 text-muted-foreground">{c.studentCount} students</span></Link></li>)}</ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </>
  );
}

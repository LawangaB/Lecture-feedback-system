import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PollResultsChart } from '@/components/LazyCharts';
import { ErrorState, LoadingBlock, PageHeader, PollStatusBadge, SessionStatusBadge, StatCard } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DIMENSION_LABEL } from '@/features/feedback/Feedback';
import { api, download, errorMessage } from '@/lib/api';
import { formatDateTime, formatPercent } from '@/lib/utils';
import type { FeedbackSummary, Poll, PollResults, Session } from '@/types/api';

interface Report { session: Session; attendanceCount: number; polls: (Pick<Poll, 'id' | 'question' | 'type' | 'status' | 'isAnonymous'> & { results: PollResults })[]; feedback: FeedbackSummary; notes: string[] }

export function ReportPage() {
  const { sessionId = '' } = useParams();
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['report', sessionId], queryFn: () => api<Report>(`/sessions/${sessionId}/report`) });
  const exportCsv = async (type: 'results' | 'feedback') => {
    setBusy(type);
    try { await download(`/sessions/${sessionId}/export.csv?type=${type}`, `${type}-${sessionId}.csv`); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  };
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} title="Report not available" />;
  const r = q.data!;
  return (
    <>
      <PageHeader eyebrow={<Link to={`/sessions/${sessionId}`} className="hover:text-foreground">← Back to session</Link>} title={`${r.session.title} — report`} description={<span className="flex items-center gap-2"><SessionStatusBadge status={r.session.status} />{r.session.course.code} · {formatDateTime(r.session.startedAt ?? r.session.createdAt)}</span>}
        actions={<><Button variant="secondary" loading={busy === 'results'} onClick={() => exportCsv('results')}><Download className="h-4 w-4" aria-hidden />Results CSV</Button><Button variant="secondary" loading={busy === 'feedback'} onClick={() => exportCsv('feedback')}><Download className="h-4 w-4" aria-hidden />Feedback CSV</Button></>} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Students joined" value={r.attendanceCount} />
        <StatCard label="Polls run" value={r.polls.length} />
        <StatCard label="Feedback received" value={r.feedback.totalEntries} hint={`${formatPercent(r.feedback.submissionRate)} of joined`} />
        <StatCard label="Comments" value={r.feedback.commentCount} />
      </div>
      <p className="mb-6 text-xs text-muted-foreground">{r.notes.join(' ')} Exports contain aggregate results only; anonymous feedback has no author or time. Exports are recorded in the audit log.</p>
      <h2 className="mb-3 font-semibold">Poll results</h2>
      {r.polls.length === 0 ? <p className="mb-6 text-sm text-muted-foreground">No polls were run in this session.</p> : (
        <div className="mb-8 space-y-4">{r.polls.map((p) => (
          <Card key={p.id}><CardHeader><div className="flex items-center gap-2"><PollStatusBadge status={p.status} /><span className="text-xs text-muted-foreground">{p.isAnonymous ? 'Anonymous' : 'Identified'}</span></div><CardTitle className="text-base">{p.question}</CardTitle></CardHeader><CardContent><PollResultsChart results={p.results} /></CardContent></Card>
        ))}</div>
      )}
      <h2 className="mb-3 font-semibold">Feedback summary</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{r.feedback.dimensions.map((d) => <StatCard key={d.dimension} label={DIMENSION_LABEL[d.dimension]} value={d.average ?? '—'} hint={`${d.count} ${d.count === 1 ? 'rating' : 'ratings'}`} />)}</div>
    </>
  );
}

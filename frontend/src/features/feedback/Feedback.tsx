import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, EyeOff, Lock, ShieldCheck, UserRound } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Progress } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { cn, formatDateTime, formatPercent } from '@/lib/utils';
import type { FeedbackDimension, FeedbackItem, FeedbackSummary, Paged } from '@/types/api';

const DIMENSIONS: { key: FeedbackDimension; label: string; low: string; high: string }[] = [
  { key: 'CLARITY', label: 'How clear was the lecture?', low: 'Unclear', high: 'Very clear' },
  { key: 'PACE', label: 'How was the pace?', low: 'Too slow / fast', high: 'Just right' },
  { key: 'ENGAGEMENT', label: 'How engaging was it?', low: 'Not engaging', high: 'Very engaging' },
  { key: 'MATERIALS', label: 'How useful were the materials?', low: 'Not useful', high: 'Very useful' },
];
export const DIMENSION_LABEL: Record<FeedbackDimension, string> = { CLARITY: 'Clarity', PACE: 'Pace', ENGAGEMENT: 'Engagement', MATERIALS: 'Materials' };

function RatingRow({ label, low, high, value, onChange }: { label: string; low: string; high: string; value?: number; onChange: (n: number | undefined) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{label} <span className="font-normal text-muted-foreground">(optional)</span></legend>
      <div className="flex items-center gap-2" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={cn('flex h-11 w-11 cursor-pointer items-center justify-center rounded-md border text-sm font-medium has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring', value === n ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface hover:bg-surface-muted')}>
            <input type="radio" name={label} value={n} checked={value === n} onChange={() => onChange(n)} onClick={() => value === n && onChange(undefined)} className="sr-only" />{n}
            <span className="sr-only"> out of 5</span>
          </label>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground" style={{ maxWidth: '16.5rem' }}><span>1 · {low}</span><span>5 · {high}</span></div>
    </fieldset>
  );
}

/** Student feedback form. Anonymity is only claimed where the server genuinely stores no link to the student. */
export function FeedbackForm({ sessionId }: { sessionId: string }) {
  const qc = useQueryClient();
  const mine = useQuery({ queryKey: ['feedback-mine', sessionId], queryFn: () => api<{ submitted: boolean }>(`/sessions/${sessionId}/feedback/mine`) });
  const [ratings, setRatings] = useState<Partial<Record<FeedbackDimension, number>>>({});
  const [comment, setComment] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api(`/sessions/${sessionId}/feedback`, { method: 'POST', body: { ratings, comment: comment.trim() || undefined, anonymous } }),
    onSuccess: () => { qc.setQueryData(['feedback-mine', sessionId], { submitted: true }); void qc.invalidateQueries({ queryKey: ['dashboard', 'student'] }); toast.success('Thanks — your feedback was sent.'); },
    onError: (e) => setError(errorMessage(e)),
  });
  if (mine.isLoading) return <LoadingBlock rows={1} />;
  if (mine.data?.submitted) return <div role="status" className="flex items-center gap-3 rounded-lg border border-success/30 bg-success-soft p-4 text-sm"><CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden /><p><strong className="text-success">Feedback received.</strong> Thank you — it helps shape the next lecture.</p></div>;
  const empty = Object.keys(ratings).length === 0 && !comment.trim();
  return (
    <Card>
      <CardHeader><CardTitle>Lecture feedback</CardTitle><CardDescription>Rate any of these, or just leave a comment. You can send feedback once per session.</CardDescription></CardHeader>
      <CardContent>
        <form noValidate className="space-y-5" onSubmit={(e) => { e.preventDefault(); setError(null); m.mutate(); }}>
          {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          {DIMENSIONS.map((d) => <RatingRow key={d.key} label={d.label} low={d.low} high={d.high} value={ratings[d.key]} onChange={(n) => setRatings((r) => { const next = { ...r }; if (n === undefined) delete next[d.key]; else next[d.key] = n; return next; })} />)}
          <Field id="fb-comment" label="Comments (optional)" hint={`${comment.length}/2000`}>{(p) => <Textarea {...p} value={comment} maxLength={2000} onChange={(e) => setComment(e.target.value)} placeholder="What worked? What should be clearer?" />}</Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Who can see this?</legend>
            <label className={cn('flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm', anonymous ? 'border-primary bg-primary-soft' : 'border-border')}>
              <input type="radio" name="anon" checked={anonymous} onChange={() => setAnonymous(true)} className="mt-1" />
              <span><span className="flex items-center gap-1.5 font-medium"><ShieldCheck className="h-4 w-4" aria-hidden />Anonymous</span><span className="text-muted-foreground">Your lecturer sees your answers but not your name, and no time is recorded.</span></span>
            </label>
            <label className={cn('flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm', !anonymous ? 'border-primary bg-primary-soft' : 'border-border')}>
              <input type="radio" name="anon" checked={!anonymous} onChange={() => setAnonymous(false)} className="mt-1" />
              <span><span className="flex items-center gap-1.5 font-medium"><UserRound className="h-4 w-4" aria-hidden />Share my name</span><span className="text-muted-foreground">Your lecturer sees who sent it.</span></span>
            </label>
          </fieldset>
          <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={empty} loading={m.isPending}>Send feedback</Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** Lecturer view: aggregates with explicit denominators, plus filterable comments. */
export function FeedbackPanel({ sessionId }: { sessionId: string }) {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ dimension: '', minRating: '', maxRating: '', anonymous: '', hasComment: '' });
  const [page, setPage] = useState(1);
  const summary = useQuery({ queryKey: ['feedback-summary', sessionId], queryFn: () => api<{ summary: FeedbackSummary }>(`/sessions/${sessionId}/feedback/summary`), refetchInterval: 20_000 });
  const qs = new URLSearchParams({ page: String(page), pageSize: '10', includeHidden: 'true' });
  for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
  const list = useQuery({ queryKey: ['feedback-list', sessionId, qs.toString()], queryFn: () => api<Paged<FeedbackItem>>(`/sessions/${sessionId}/feedback?${qs}`), placeholderData: (p) => p });
  const hide = useMutation({
    mutationFn: ({ id, isHidden }: { id: string; isHidden: boolean }) => api(`/feedback/${id}`, { method: 'PATCH', body: { isHidden } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['feedback-list', sessionId] }); void qc.invalidateQueries({ queryKey: ['feedback-summary', sessionId] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLSelectElement>) => { setPage(1); setFilters((f) => ({ ...f, [k]: e.target.value })); };
  if (summary.isLoading) return <LoadingBlock />;
  if (summary.isError) return <ErrorState error={summary.error} onRetry={() => summary.refetch()} />;
  const s = summary.data!.summary;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {s.dimensions.map((d) => (
          <div key={d.dimension} className="rounded-lg border border-border bg-surface p-4">
            <p className="text-sm text-muted-foreground">{DIMENSION_LABEL[d.dimension]}</p>
            <p className="tabular mt-1 text-2xl font-semibold">{d.average ?? '—'}<span className="text-sm font-normal text-muted-foreground"> / 5</span></p>
            <Progress value={((d.average ?? 0) / 5) * 100} label={`${DIMENSION_LABEL[d.dimension]} average`} className="mt-2" />
            <p className="tabular mt-1.5 text-xs text-muted-foreground">{d.count} {d.count === 1 ? 'rating' : 'ratings'}</p>
          </div>
        ))}
      </div>
      <p className="tabular text-sm text-muted-foreground">{s.totalEntries} {s.totalEntries === 1 ? 'submission' : 'submissions'} from {s.joinedParticipants} joined students ({formatPercent(s.submissionRate)}). Students who did not respond are not counted as ratings.</p>

      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field id="f-dim" label="Rating type" className="w-40">{(p) => <Select {...p} value={filters.dimension} onChange={set('dimension')}><option value="">All</option>{Object.entries(DIMENSION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
          <Field id="f-min" label="Min rating" className="w-28">{(p) => <Select {...p} value={filters.minRating} onChange={set('minRating')}><option value="">Any</option>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</Select>}</Field>
          <Field id="f-max" label="Max rating" className="w-28">{(p) => <Select {...p} value={filters.maxRating} onChange={set('maxRating')}><option value="">Any</option>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</Select>}</Field>
          <Field id="f-anon" label="Author" className="w-40">{(p) => <Select {...p} value={filters.anonymous} onChange={set('anonymous')}><option value="">All</option><option value="true">Anonymous only</option><option value="false">Named only</option></Select>}</Field>
          <Field id="f-com" label="Comments" className="w-40">{(p) => <Select {...p} value={filters.hasComment} onChange={set('hasComment')}><option value="">All</option><option value="true">With comment</option></Select>}</Field>
        </div>
        {list.isLoading ? <LoadingBlock rows={2} /> : list.isError ? <ErrorState error={list.error} /> : list.data!.items.length === 0 ? <EmptyState title="No feedback matches" description="Feedback appears here as students submit it." /> : (
          <ul className="space-y-3" aria-live="polite">
            {list.data!.items.map((f) => (
              <li key={f.id} className="rounded-lg border border-border bg-surface p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={f.author ? 'primary' : 'neutral'}>{f.author ? f.author.displayName : 'Anonymous'}</Badge>
                  {Object.entries(f.ratings).map(([k, v]) => <Badge key={k}>{DIMENSION_LABEL[k as FeedbackDimension]} {v}/5</Badge>)}
                  {f.createdAt && <time className="ml-auto text-xs text-muted-foreground" dateTime={f.createdAt}>{formatDateTime(f.createdAt)}</time>}
                </div>
                {f.comment && <p className={cn('mt-2 whitespace-pre-wrap break-words text-sm', f.isHidden && 'text-muted-foreground line-through')}>{f.comment}</p>}
                {f.comment && <Button variant="ghost" size="sm" className="mt-1 -ml-2" onClick={() => hide.mutate({ id: f.id, isHidden: !f.isHidden })}>{f.isHidden ? <><Lock className="h-3.5 w-3.5" aria-hidden />Unhide comment</> : <><EyeOff className="h-3.5 w-3.5" aria-hidden />Hide comment</>}</Button>}
              </li>
            ))}
          </ul>
        )}
        {list.data && list.data.total > list.data.pageSize && (
          <div className="flex items-center justify-between text-sm">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="tabular text-muted-foreground">Page {page} of {Math.ceil(list.data.total / list.data.pageSize)}</span>
            <Button variant="secondary" size="sm" disabled={page * list.data.pageSize >= list.data.total} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        )}
      </div>
    </div>
  );
}

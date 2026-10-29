import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Pause, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PollResultsChart } from '@/components/LazyCharts';
import { ConnectionBadge, EmptyState, PageHeader, SessionStatusBadge } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FeedbackForm } from '@/features/feedback/Feedback';
import { useCountdown } from '@/hooks/useCountdown';
import { api, ApiError, errorMessage } from '@/lib/api';
import { cn, formatClock } from '@/lib/utils';
import type { Poll, Snapshot } from '@/types/api';
import type { ConnectionState } from './useLiveSession';

const newKey = () => `k-${crypto.randomUUID()}`;

function AnswerCard({ poll, snapshot, clockOffset, connection }: { poll: Poll; snapshot: Snapshot; clockOffset: number; connection: ConnectionState }) {
  const qc = useQueryClient();
  const sessionKey = ['session', snapshot.session.id];
  const remaining = useCountdown(poll, clockOffset);
  const [choice, setChoice] = useState<string[]>([]);
  const [rating, setRating] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  // Confirmed-by-server state is kept locally too, so a stale in-flight snapshot refetch can never re-open a submitted poll.
  const [submitted, setSubmitted] = useState<{ optionIds: string[]; ratingValue: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One idempotency key per logical submission: a retry after a network error reuses it, so it can never double-count.
  const keyRef = useRef(newKey());

  const sessionLive = snapshot.session.status === 'LIVE';
  const answered = (poll.hasResponded || submitted !== null) && !editing;
  const open = poll.status === 'OPEN' && sessionLive && (remaining === null || remaining > 0);
  const max = poll.type === 'SINGLE_CHOICE' ? 1 : (poll.maxSelections ?? poll.options.length);
  const min = poll.type === 'SINGLE_CHOICE' ? 1 : (poll.minSelections ?? 1);
  const valid = poll.type === 'RATING' ? rating !== null : choice.length >= min && choice.length <= max;

  const submit = useMutation({
    mutationFn: () => api<{ status: string }>(`/polls/${poll.id}/responses`, { method: 'POST', body: { ...(poll.type === 'RATING' ? { ratingValue: rating } : { optionIds: choice }), idempotencyKey: keyRef.current } }),
    onSuccess: () => {
      // Only now — after the server confirmed it persisted — do we show "submitted".
      qc.setQueryData<Snapshot>(sessionKey, (s) => s && ({ ...s, polls: s.polls.map((p) => (p.id === poll.id ? { ...p, hasResponded: true, myResponse: poll.isAnonymous ? null : { optionIds: choice, ratingValue: rating } } : p)) }));
      setSubmitted({ optionIds: choice, ratingValue: rating });
      setEditing(false); setError(null); keyRef.current = newKey();
    },
    onError: (e) => {
      if (e instanceof ApiError && (e.code === 'ALREADY_RESPONDED' || e.code === 'POLL_NOT_OPEN' || e.code === 'SESSION_NOT_LIVE')) void qc.invalidateQueries({ queryKey: sessionKey });
      setError(errorMessage(e));
    },
  });

  const toggle = (id: string) => setChoice((c) => (poll.type === 'SINGLE_CHOICE' ? [id] : c.includes(id) ? c.filter((x) => x !== id) : c.length < max ? [...c, id] : c));
  const hint = poll.type === 'SINGLE_CHOICE' ? 'Choose one answer' : poll.type === 'MULTIPLE_CHOICE' ? `Choose ${min === max ? max : `${min} to ${max}`}` : `Rate from ${poll.ratingMin ?? 1} to ${poll.ratingMax ?? 5}`;
  const mine = poll.isAnonymous ? null : (submitted ?? poll.myResponse);

  return (
    <Card className="border-primary/40">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0"><div className="mb-1.5 flex flex-wrap items-center gap-2"><Badge tone={poll.status === 'OPEN' ? 'success' : 'warning'}>{poll.status === 'OPEN' ? 'Open' : 'Paused'}</Badge><span className="text-xs text-muted-foreground">{poll.isAnonymous ? 'Anonymous — your name is not saved with your answer' : 'Your name is saved with your answer'}</span></div><CardTitle className="text-xl leading-snug">{poll.question}</CardTitle></div>
        {remaining !== null && <p className="tabular flex shrink-0 items-center gap-1.5 rounded-md bg-surface-muted px-2.5 py-1.5 text-lg font-bold" aria-label={`${formatClock(remaining)} left`}><Clock className="h-4 w-4" aria-hidden />{formatClock(remaining)}</p>}
      </CardHeader>
      <CardContent className="space-y-4">
        {!sessionLive && <p role="status" className="flex items-center gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning"><Pause className="h-4 w-4" aria-hidden />The session is paused. Answers are on hold.</p>}
        {poll.status === 'PAUSED' && sessionLive && <p role="status" className="flex items-center gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning"><Pause className="h-4 w-4" aria-hidden />This poll is paused by your lecturer.</p>}
        {connection !== 'connected' && <p role="status" className="flex items-center gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning"><WifiOff className="h-4 w-4" aria-hidden />{connection === 'offline' ? 'You are offline.' : 'Reconnecting…'} Your answer is only saved once you see the confirmation.</p>}
        {answered ? (
          <div role="status" className="space-y-3 rounded-lg border border-success/30 bg-success-soft p-4">
            <p className="flex items-center gap-2 font-medium text-success"><CheckCircle2 className="h-5 w-5" aria-hidden />Answer received</p>
            {mine && <p className="text-sm">You answered: <strong>{mine.ratingValue !== null ? mine.ratingValue : mine.optionIds.map((id) => poll.options.find((o) => o.id === id)?.label).join(', ')}</strong></p>}
            {!poll.resultsVisible && <p className="text-sm text-muted-foreground">Results will appear here when your lecturer shares them.</p>}
            {poll.allowResponseUpdate && open && <Button variant="secondary" size="sm" onClick={() => { setEditing(true); setChoice(mine?.optionIds ?? []); setRating(mine?.ratingValue ?? null); }}>Change my answer</Button>}
          </div>
        ) : (
          <form noValidate onSubmit={(e) => { e.preventDefault(); if (valid && open) { setError(null); submit.mutate(); } }}>
            <fieldset disabled={!open || submit.isPending} className="space-y-3">
              <legend className="mb-2 text-sm text-muted-foreground">{hint}</legend>
              {poll.type === 'RATING' ? (
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={hint}>
                  {Array.from({ length: (poll.ratingMax ?? 5) - (poll.ratingMin ?? 1) + 1 }, (_, i) => (poll.ratingMin ?? 1) + i).map((n) => (
                    <label key={n} className={cn('flex h-14 min-w-14 flex-1 cursor-pointer items-center justify-center rounded-lg border-2 text-lg font-semibold has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:disabled]:cursor-not-allowed', rating === n ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface hover:bg-surface-muted')}>
                      <input type="radio" name={`rate-${poll.id}`} className="sr-only" checked={rating === n} onChange={() => setRating(n)} />{n}
                    </label>
                  ))}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {poll.options.map((o) => {
                    const on = choice.includes(o.id);
                    return (
                      <label key={o.id} className={cn('flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border-2 px-4 py-3 text-base has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-70', on ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:bg-surface-muted')}>
                        <input type={poll.type === 'SINGLE_CHOICE' ? 'radio' : 'checkbox'} name={`opt-${poll.id}`} className="h-5 w-5 shrink-0 accent-[var(--color-primary)]" checked={on} onChange={() => toggle(o.id)} />
                        <span className="min-w-0 break-words">{o.label}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>
            {error && <p role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
            <Button type="submit" size="lg" className="mt-4 w-full" disabled={!valid || !open} loading={submit.isPending}>{error && !submit.isPending ? 'Try again' : editing ? 'Update my answer' : 'Submit answer'}</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function StudentLive({ snapshot, connection, clockOffset }: { snapshot: Snapshot; connection: ConnectionState; clockOffset: number }) {
  const { session } = snapshot;
  // Opening a live session is an explicit "I'm here" action; record it once (idempotent on the server).
  const attended = useRef(false);
  const live = session.status === 'LIVE' || session.status === 'PAUSED';
  useEffect(() => {
    if (live && !attended.current) {
      attended.current = true;
      api(`/sessions/${session.id}/attend`, { method: 'POST' }).catch(() => { attended.current = false; });
    }
  }, [live, session.id]);
  const active = snapshot.polls.find((p) => p.status === 'OPEN' || p.status === 'PAUSED');
  const closed = snapshot.polls.filter((p) => p.status === 'CLOSED').reverse();
  const activeResults = active ? snapshot.results[active.id] : undefined;
  // Screen-reader announcements for state changes only — never for every counter tick.
  const [announcement, setAnnouncement] = useState('');
  const prev = useRef<string>('');
  const activeId = active?.id;
  const activeStatus = active?.status;
  const activeQuestion = active?.question;
  const sessionStatus = session.status;
  useEffect(() => {
    const now = `${activeId ?? 'none'}:${activeStatus ?? ''}:${sessionStatus}`;
    if (prev.current && prev.current !== now) {
      setAnnouncement(activeId ? `${activeStatus === 'OPEN' ? 'A poll is open' : 'The poll is paused'}: ${activeQuestion}` : sessionStatus === 'ENDED' ? 'The session has ended.' : 'The poll has closed.');
    }
    prev.current = now;
  }, [activeId, activeStatus, activeQuestion, sessionStatus]);

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      <PageHeader
        eyebrow={<Link to={`/courses/${session.course.id}`} className="hover:text-foreground">{session.course.code} · {session.course.title}</Link>}
        title={session.title}
        description={<span className="flex flex-wrap items-center gap-2"><SessionStatusBadge status={session.status} />{session.status !== 'ENDED' && <ConnectionBadge state={connection} />}</span>}
      />
      <div className="mx-auto max-w-2xl space-y-6">
        {session.status === 'SCHEDULED' && <EmptyState icon={<Clock className="h-5 w-5" aria-hidden />} title="This lecture hasn't started" description="Keep this page open — polls will appear as soon as your lecturer begins." />}
        {session.status === 'ENDED' && <p role="status" className="rounded-lg bg-surface-muted px-4 py-3 text-sm">This session has ended. Thanks for taking part.</p>}
        {active ? <AnswerCard key={active.id} poll={active} snapshot={snapshot} clockOffset={clockOffset} connection={connection} /> : (session.status === 'LIVE' || session.status === 'PAUSED') && <EmptyState icon={<Clock className="h-5 w-5" aria-hidden />} title="Waiting for the next poll" description="You're in. A question will appear here the moment your lecturer opens one." />}
        {active && active.resultsVisible && activeResults && <Card><CardHeader><CardTitle>Live results</CardTitle></CardHeader><CardContent><PollResultsChart results={activeResults} highlightOptionIds={active.myResponse?.optionIds} /></CardContent></Card>}
        {closed.length > 0 && (
          <section aria-labelledby="past-h" className="space-y-3">
            <h2 id="past-h" className="font-semibold">Closed polls</h2>
            {closed.map((p) => {
              const r = snapshot.results[p.id];
              return (
                <Card key={p.id}><CardHeader><CardTitle className="text-base">{p.question}</CardTitle><p className="text-xs text-muted-foreground">{p.hasResponded ? 'You answered this poll.' : 'You did not answer this poll.'}</p></CardHeader>
                  <CardContent>{p.resultsVisible && r ? <PollResultsChart results={r} highlightOptionIds={p.myResponse?.optionIds} /> : <p className="text-sm text-muted-foreground">Results haven't been shared.</p>}</CardContent></Card>
              );
            })}
          </section>
        )}
        {session.feedbackEnabled && session.status !== 'SCHEDULED' && <FeedbackForm sessionId={session.id} />}
      </div>
    </>
  );
}

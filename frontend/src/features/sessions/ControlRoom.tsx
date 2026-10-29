import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, EyeOff, FileText, Pause, Pencil, Play, Plus, RefreshCw, Rocket, SkipForward, Square, Trash2, Users, Eye } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PollResultsChart } from '@/components/LazyCharts';
import { ConnectionBadge, EmptyState, PageHeader, PollStatusBadge, SessionStatusBadge } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FeedbackPanel } from '@/features/feedback/Feedback';
import { PollBuilderDialog } from '@/features/polls/PollBuilder';
import { useCountdown } from '@/hooks/useCountdown';
import { api, errorMessage } from '@/lib/api';
import { formatClock, formatDateTime, formatPercent } from '@/lib/utils';
import type { Poll, Snapshot } from '@/types/api';
import type { ConnectionState } from './useLiveSession';

type Confirm = { title: string; description: string; label: string; destructive?: boolean; run: () => Promise<unknown> } | null;

function useAction(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, method = 'POST' }: { path: string; method?: 'POST' | 'DELETE'; ok?: string }) => api(path, { method }),
    onSuccess: (_d, v) => { void qc.invalidateQueries({ queryKey: ['session', sessionId] }); if (v.ok) toast.success(v.ok); },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

function JoinPanel({ snapshot, onConfirm }: { snapshot: Snapshot; onConfirm: (c: Confirm) => void }) {
  const { session } = snapshot;
  const act = useAction(session.id);
  const [copied, setCopied] = useState(false);
  const code = session.joinCode;
  const link = code ? `${window.location.origin}/join?code=${code}` : '';
  const live = session.status === 'LIVE' || session.status === 'PAUSED';
  return (
    <Card>
      <CardHeader><CardTitle>Join this lecture</CardTitle><CardDescription>{live ? 'Students enter the code or scan the QR.' : session.status === 'ENDED' ? 'This session has ended.' : 'The code is created when you start the session.'}</CardDescription></CardHeader>
      <CardContent>
        {code && session.status !== 'ENDED' ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <p className="tabular select-all rounded-lg bg-primary-soft px-5 py-3 text-4xl font-bold tracking-[0.3em] text-primary" aria-label={`Join code ${code.split('').join(' ')}`}>{code}</p>
            <div className="rounded-lg border border-border bg-white p-3"><QRCodeSVG value={link} size={168} marginSize={0} title="QR code to join this lecture" /></div>
            <p className="text-xs text-muted-foreground">Can't scan? Go to <strong className="text-foreground">{window.location.host}/join</strong> and type the code.</p>
            {session.joinCodeExpiresAt && <p className="text-xs text-muted-foreground">Code valid until {formatDateTime(session.joinCodeExpiresAt, { timeStyle: 'short' })}</p>}
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="secondary" size="sm" onClick={async () => { await navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}{copied ? 'Copied' : 'Copy link'}</Button>
              <Button variant="secondary" size="sm" onClick={() => onConfirm({ title: 'Generate a new code?', description: 'The current code and QR stop working immediately. Students already in the session stay in.', label: 'Generate new code', run: () => act.mutateAsync({ path: `/sessions/${session.id}/join-code/rotate`, ok: 'New code generated.' }) })}><RefreshCw className="h-4 w-4" aria-hidden />New code</Button>
            </div>
          </div>
        ) : <p className="text-sm text-muted-foreground">{session.status === 'ENDED' ? 'Joining is closed.' : 'Start the session to generate a join code.'}</p>}
      </CardContent>
    </Card>
  );
}

function ActivePoll({ poll, snapshot, clockOffset, onConfirm, nextDraft }: { poll: Poll; snapshot: Snapshot; clockOffset: number; onConfirm: (c: Confirm) => void; nextDraft?: Poll }) {
  const sessionId = snapshot.session.id;
  const act = useAction(sessionId);
  const remaining = useCountdown(poll, clockOffset);
  const results = snapshot.results[poll.id];
  const joined = snapshot.participants?.joined ?? results?.joinedParticipants ?? 0;
  const total = results?.totalResponses ?? 0;
  const rate = joined > 0 ? Math.min(1, total / joined) : null;
  const elapsedPct = poll.durationSeconds && remaining !== null ? 100 - (remaining / (poll.durationSeconds * 1000)) * 100 : null;
  const isLive = snapshot.session.status === 'LIVE';
  const close = () => act.mutateAsync({ path: `/polls/${poll.id}/close`, ok: 'Poll closed.' });
  return (
    <Card className="border-primary/40">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0"><div className="mb-1 flex items-center gap-2"><PollStatusBadge status={poll.status} /><span className="text-xs text-muted-foreground">{poll.isAnonymous ? 'Anonymous' : 'Identified'}</span></div><CardTitle className="text-xl leading-snug">{poll.question}</CardTitle></div>
        {remaining !== null && <div className="shrink-0 text-right"><p className="tabular text-3xl font-bold" aria-label={`${formatClock(remaining)} remaining`}>{formatClock(remaining)}</p><p className="text-xs text-muted-foreground">{poll.status === 'PAUSED' ? 'timer paused' : 'remaining'}</p></div>}
      </CardHeader>
      <CardContent className="space-y-5">
        {elapsedPct !== null && <Progress value={elapsedPct} label="Time elapsed" />}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-md bg-surface-muted p-3"><p className="text-xs text-muted-foreground">Responses</p><p className="tabular text-2xl font-semibold" aria-live="polite">{total}</p></div>
          <div className="rounded-md bg-surface-muted p-3"><p className="text-xs text-muted-foreground">Joined</p><p className="tabular text-2xl font-semibold">{joined}</p></div>
          <div className="rounded-md bg-surface-muted p-3"><p className="text-xs text-muted-foreground">Participation</p><p className="tabular text-2xl font-semibold">{formatPercent(rate)}</p></div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {poll.resultsVisible ? <><Eye className="h-4 w-4 text-success" aria-hidden /><span><strong>Results are visible to students.</strong></span></> : <><EyeOff className="h-4 w-4 text-warning" aria-hidden /><span><strong>Results are hidden from students</strong> <span className="text-muted-foreground">({poll.resultsVisibility === 'AFTER_CLOSE' ? 'shown after the poll closes' : 'until you reveal them'})</span></span></>}
        </div>
        {results ? <PollResultsChart results={results} /> : <p className="text-sm text-muted-foreground">Waiting for the first response…</p>}
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {poll.status === 'OPEN' && <Button variant="secondary" onClick={() => act.mutate({ path: `/polls/${poll.id}/pause` })}><Pause className="h-4 w-4" aria-hidden />Pause</Button>}
          {poll.status === 'PAUSED' && <Button variant="secondary" disabled={!isLive} onClick={() => act.mutate({ path: `/polls/${poll.id}/resume` })}><Play className="h-4 w-4" aria-hidden />Resume</Button>}
          <Button variant="danger" onClick={() => onConfirm({ title: 'Close this poll?', description: 'Every student will be told the poll has closed and can no longer answer. This cannot be undone.', label: 'Close poll', destructive: true, run: close })}><Square className="h-4 w-4" aria-hidden />Close poll</Button>
          {nextDraft && <Button variant="soft" onClick={() => onConfirm({ title: 'Close and open the next poll?', description: `This poll closes for everyone, then "${nextDraft.question}" opens immediately.`, label: 'Close and open next', run: async () => { await close(); await act.mutateAsync({ path: `/polls/${nextDraft.id}/open`, ok: 'Next poll is open.' }); } })}><SkipForward className="h-4 w-4" aria-hidden />Close &amp; open next</Button>}
          {!poll.resultsVisible && <Button variant="ghost" onClick={() => onConfirm({ title: 'Show results to students?', description: 'All students in the session will see the current results for this poll.', label: 'Show results', run: () => act.mutateAsync({ path: `/polls/${poll.id}/reveal-results`, ok: 'Results are now visible to students.' }) })}><Eye className="h-4 w-4" aria-hidden />Show results to students</Button>}
        </div>
      </CardContent>
    </Card>
  );
}

function PollList({ snapshot, onEdit, onConfirm }: { snapshot: Snapshot; onEdit: (p: Poll) => void; onConfirm: (c: Confirm) => void }) {
  const act = useAction(snapshot.session.id);
  const active = snapshot.polls.find((p) => p.status === 'OPEN' || p.status === 'PAUSED');
  const canLaunch = snapshot.session.status === 'LIVE' && !active;
  if (snapshot.polls.length === 0) return <EmptyState icon={<Rocket className="h-5 w-5" aria-hidden />} title="No polls yet" description="Create a poll to check understanding. Save drafts ahead of time and launch them during the lecture." />;
  return (
    <ul className="space-y-3">
      {snapshot.polls.map((p, i) => {
        const r = snapshot.results[p.id];
        return (
          <li key={p.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><p className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><span className="tabular">#{i + 1}</span><PollStatusBadge status={p.status} />{p.isRequired && <Badge tone="warning">Required</Badge>}<span>{p.isAnonymous ? 'Anonymous' : 'Identified'}</span></p><p className="font-medium">{p.question}</p><p className="mt-0.5 text-xs text-muted-foreground tabular">{p.type === 'RATING' ? `Rating 1–${p.ratingMax}` : `${p.options.length} options`}{p.durationSeconds ? ` · ${p.durationSeconds}s limit` : ''}{p.status !== 'DRAFT' ? ` · ${r?.totalResponses ?? p.responseCount ?? 0} responses` : ''}</p></div>
              <div className="flex gap-1.5">
                {p.status === 'DRAFT' && <>
                  <Button size="sm" disabled={!canLaunch} title={canLaunch ? undefined : active ? 'Close the active poll first' : 'Start the session first'} onClick={() => act.mutate({ path: `/polls/${p.id}/open`, ok: 'Poll is open.' })}><Rocket className="h-4 w-4" aria-hidden />Launch</Button>
                  <Button variant="secondary" size="icon" className="h-8 w-8" aria-label={`Edit poll ${i + 1}`} onClick={() => onEdit(p)}><Pencil className="h-4 w-4" aria-hidden /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Delete poll ${i + 1}`} onClick={() => onConfirm({ title: 'Delete this draft?', description: 'The draft poll will be permanently removed.', label: 'Delete', destructive: true, run: () => act.mutateAsync({ path: `/polls/${p.id}`, method: 'DELETE', ok: 'Draft deleted.' }) })}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                </>}
              </div>
            </div>
            {p.status === 'CLOSED' && r && <details className="mt-3"><summary className="cursor-pointer text-sm text-primary">Show results</summary><div className="mt-3"><PollResultsChart results={r} /></div></details>}
          </li>
        );
      })}
    </ul>
  );
}

export function ControlRoom({ snapshot, connection, clockOffset }: { snapshot: Snapshot; connection: ConnectionState; clockOffset: number }) {
  const { session } = snapshot;
  const act = useAction(session.id);
  const [builder, setBuilder] = useState<{ open: boolean; poll?: Poll }>({ open: false });
  const [confirm, setConfirm] = useState<Confirm>(null);
  const active = snapshot.polls.find((p) => p.status === 'OPEN' || p.status === 'PAUSED');
  const nextDraft = snapshot.polls.find((p) => p.status === 'DRAFT');
  const ended = session.status === 'ENDED';
  const base = `/sessions/${session.id}`;
  return (
    <>
      <PageHeader
        eyebrow={<span className="flex items-center gap-2"><Link to={`/courses/${session.course.id}`} className="hover:text-foreground">{session.course.code} · {session.course.title}</Link></span>}
        title={session.title}
        description={<span className="flex flex-wrap items-center gap-2"><SessionStatusBadge status={session.status} />{!ended && <ConnectionBadge state={connection} />}{session.startedAt && <span className="text-xs">Started {formatDateTime(session.startedAt, { timeStyle: 'short', dateStyle: 'medium' })}</span>}</span>}
        actions={<>
          {session.status === 'SCHEDULED' && <Button onClick={() => act.mutate({ path: `${base}/start`, ok: 'Session is live.' })} loading={act.isPending}><Play className="h-4 w-4" aria-hidden />Start session</Button>}
          {session.status === 'LIVE' && <Button variant="secondary" onClick={() => setConfirm({ title: 'Pause the session?', description: 'Student answers are blocked while paused, and any open poll is paused too.', label: 'Pause session', run: () => act.mutateAsync({ path: `${base}/pause`, ok: 'Session paused.' }) })}><Pause className="h-4 w-4" aria-hidden />Pause</Button>}
          {session.status === 'PAUSED' && <Button onClick={() => act.mutate({ path: `${base}/resume`, ok: 'Session resumed.' })}><Play className="h-4 w-4" aria-hidden />Resume</Button>}
          {(session.status === 'LIVE' || session.status === 'PAUSED') && <Button variant="danger" onClick={() => setConfirm({ title: 'End this session?', description: 'Open polls close, the join code stops working, and the session becomes read-only. This cannot be undone.', label: 'End session', destructive: true, run: () => act.mutateAsync({ path: `${base}/end`, ok: 'Session ended.' }) })}><Square className="h-4 w-4" aria-hidden />End</Button>}
          <Button variant="secondary" asChild><Link to={`${base}/report`}><FileText className="h-4 w-4" aria-hidden />Report</Link></Button>
        </>}
      />
      {session.status === 'PAUSED' && <p role="status" className="mb-4 rounded-md bg-warning-soft px-4 py-3 text-sm text-warning">The session is paused. Students cannot submit answers until you resume.</p>}
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          {active ? <ActivePoll poll={active} snapshot={snapshot} clockOffset={clockOffset} onConfirm={setConfirm} nextDraft={nextDraft} /> : (
            <Card><CardContent className="pt-5"><EmptyState icon={<Rocket className="h-5 w-5" aria-hidden />} title={ended ? 'This session has ended' : session.status === 'LIVE' ? 'No poll is open' : 'Start the session to launch polls'} description={ended ? 'Results and feedback remain available below and in the report.' : nextDraft ? `Next up: "${nextDraft.question}"` : 'Create a poll below, then launch it when you want students to answer.'} action={!ended && nextDraft && session.status === 'LIVE' ? <Button onClick={() => act.mutate({ path: `/polls/${nextDraft.id}/open`, ok: 'Poll is open.' })}><Rocket className="h-4 w-4" aria-hidden />Launch next poll</Button> : undefined} /></CardContent></Card>
          )}
          <Tabs defaultValue="polls">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <TabsList><TabsTrigger value="polls">Polls ({snapshot.polls.length})</TabsTrigger><TabsTrigger value="feedback">Feedback</TabsTrigger></TabsList>
              {!ended && <Button size="sm" onClick={() => setBuilder({ open: true })}><Plus className="h-4 w-4" aria-hidden />New poll</Button>}
            </div>
            <TabsContent value="polls"><PollList snapshot={snapshot} onEdit={(p) => setBuilder({ open: true, poll: p })} onConfirm={setConfirm} /></TabsContent>
            <TabsContent value="feedback"><FeedbackPanel sessionId={session.id} /></TabsContent>
          </Tabs>
        </div>
        <aside className="space-y-6">
          <JoinPanel snapshot={snapshot} onConfirm={setConfirm} />
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-4 w-4" aria-hidden />Participants</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div><p className="tabular text-2xl font-semibold">{snapshot.participants?.joined ?? 0}</p><p className="text-xs text-muted-foreground">joined with the code</p></div>
              <div><p className="tabular text-2xl font-semibold">{snapshot.participants?.connected ?? 0}</p><p className="text-xs text-muted-foreground">connected now</p></div>
              <p className="col-span-2 text-xs text-muted-foreground">An open browser tab is not proof of attendance, so participation rates use students who joined.</p>
            </CardContent></Card>
        </aside>
      </div>
      <PollBuilderDialog sessionId={session.id} poll={builder.poll} open={builder.open} onOpenChange={(o) => setBuilder((b) => ({ ...b, open: o }))} />
      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title={confirm?.title ?? ''} description={confirm?.description ?? ''} confirmLabel={confirm?.label ?? ''} destructive={confirm?.destructive} onConfirm={async () => { await confirm?.run(); }} />
    </>
  );
}

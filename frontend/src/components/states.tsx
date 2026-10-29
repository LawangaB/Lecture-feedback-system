import { AlertTriangle, Inbox, Loader2, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api';
import type { ConnectionState } from '@/features/sessions/useLiveSession';
import type { PollStatus, SessionStatus } from '@/types/api';

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{eyebrow}</div>}
        <h1 className="truncate text-2xl font-semibold sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-soft text-primary">{icon ?? <Inbox className="h-5 w-5" aria-hidden />}</div>
      <div>
        <p className="font-medium">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'We could not load this' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-danger/30 bg-danger-soft px-6 py-8 text-center">
      <AlertTriangle className="h-6 w-6 text-danger" aria-hidden />
      <div>
        <p className="font-medium text-danger">{title}</p>
        <p className="mt-1 text-sm text-foreground/80">{errorMessage(error)}</p>
      </div>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-3">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-20 w-full" />)}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export const FullPageSpinner = () => (
  <div role="status" className="flex min-h-dvh items-center justify-center text-muted-foreground">
    <Loader2 className="h-6 w-6 animate-spin" aria-hidden /><span className="sr-only">Loading…</span>
  </div>
);

const SESSION_TONE: Record<SessionStatus, { tone: 'neutral' | 'success' | 'warning' | 'primary'; label: string }> = {
  SCHEDULED: { tone: 'neutral', label: 'Scheduled' }, LIVE: { tone: 'success', label: 'Live' }, PAUSED: { tone: 'warning', label: 'Paused' }, ENDED: { tone: 'neutral', label: 'Ended' },
};
// Status is always conveyed with text as well as colour (WCAG 1.4.1).
export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  const s = SESSION_TONE[status];
  return <Badge tone={s.tone}>{status === 'LIVE' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden />}{s.label}</Badge>;
}
const POLL_TONE: Record<PollStatus, { tone: 'neutral' | 'success' | 'warning' | 'primary'; label: string }> = {
  DRAFT: { tone: 'neutral', label: 'Draft' }, OPEN: { tone: 'success', label: 'Open' }, PAUSED: { tone: 'warning', label: 'Paused' }, CLOSED: { tone: 'primary', label: 'Closed' },
};
export const PollStatusBadge = ({ status }: { status: PollStatus }) => <Badge tone={POLL_TONE[status].tone}>{POLL_TONE[status].label}</Badge>;

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  const map = {
    connected: { tone: 'success' as const, label: 'Live connection' },
    connecting: { tone: 'neutral' as const, label: 'Connecting…' },
    reconnecting: { tone: 'warning' as const, label: 'Reconnecting…' },
    offline: { tone: 'danger' as const, label: 'Offline' },
  }[state];
  return (
    <Badge tone={map.tone} role="status" aria-live="polite">
      {state === 'connected' ? <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden /> : <WifiOff className="h-3 w-3" aria-hidden />}
      {map.label}
    </Badge>
  );
}

export function StatCard({ label, value, hint, icon, live = false }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode; live?: boolean }) {
  return (
    <div className="stat-tile group relative overflow-hidden rounded-lg border border-border bg-surface p-4 shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-pop">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-primary via-primary/50 to-transparent" aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="tabular mt-3 text-3xl font-semibold">{value}</p>
        </div>
        {icon && <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary transition-transform duration-200 group-hover:scale-105">{icon}</span>}
      </div>
      <div className="mt-1 flex min-h-5 items-center justify-between gap-2">
        {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
        {live && <span className="inline-flex shrink-0 items-center gap-1.5 text-[0.65rem] font-semibold uppercase tracking-wide text-success"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden />Live</span>}
      </div>
    </div>
  );
}

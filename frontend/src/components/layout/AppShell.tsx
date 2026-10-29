import * as Dialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { Activity, BarChart3, BookOpen, Bell, ChevronRight, KeyRound, LayoutDashboard, LogOut, Menu, Moon, ScrollText, Sun, Users, X, DoorOpen } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAuth } from '@/features/auth/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { api } from '@/lib/api';
import { cn, initials } from '@/lib/utils';
import type { Role, Session } from '@/types/api';

interface NavItem { to: string; label: string; icon: typeof BookOpen; end?: boolean }
const NAV: Record<Role, NavItem[]> = {
  STUDENT: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/join', label: 'Join a lecture', icon: DoorOpen },
    { to: '/courses', label: 'My courses', icon: BookOpen },
  ],
  LECTURER: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/courses', label: 'Courses', icon: BookOpen },
  ],
  ADMIN: [
    { to: '/', label: 'Overview', icon: BarChart3, end: true },
    { to: '/admin/users', label: 'Users', icon: Users },
    { to: '/courses', label: 'Courses', icon: BookOpen },
    { to: '/admin/audit', label: 'Audit log', icon: ScrollText },
  ],
};

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5 rounded-md px-1 font-semibold">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground"><BarChart3 className="h-4 w-4" aria-hidden /></span>
      <span>Lecture Feedback</span>
    </Link>
  );
}

function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to} to={to} end={end} onClick={onNavigate}
          className={({ isActive }) => cn('relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors', isActive ? 'bg-primary-soft text-primary before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary' : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground')}
        >
          <Icon className="h-4 w-4" aria-hidden />{label}
        </NavLink>
      ))}
    </nav>
  );
}

const LABELS: Record<string, string> = { courses: 'Courses', sessions: 'Session', join: 'Join a lecture', account: 'Account', admin: 'Admin', users: 'Users', audit: 'Audit log', report: 'Report' };
function Breadcrumbs() {
  const { pathname } = useLocation();
  const parts = pathname.split('/').filter(Boolean).filter((p) => LABELS[p]);
  if (parts.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="hidden items-center gap-1 text-sm text-muted-foreground sm:flex">
      <Link to="/" className="hover:text-foreground">Home</Link>
      {parts.map((p) => (<span key={p} className="flex items-center gap-1"><ChevronRight className="h-3.5 w-3.5" aria-hidden /><span className={cn(p === parts.at(-1) && 'text-foreground')}>{LABELS[p]}</span></span>))}
    </nav>
  );
}

/** Real notifications: lectures that are live right now for this user. */
function LiveNotifications({ live, isFetching }: { live: Session[]; isFetching: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={live.length ? `Notifications: ${live.length} live lecture${live.length > 1 ? 's' : ''}` : 'Notifications'} title="Live lecture notifications" className="relative">
          <Bell className={cn('h-4 w-4', isFetching && 'animate-pulse')} aria-hidden />
          {live.length > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-success" aria-hidden />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Live now</DropdownMenuLabel>
        {live.length === 0 && <p className="px-2.5 py-3 text-sm text-muted-foreground">No lectures are live right now.</p>}
        {live.map((s) => (
          <DropdownMenuItem key={s.id} asChild>
            <Link to={`/sessions/${s.id}`} className="flex-col items-start gap-0.5"><span className="font-medium">{s.title}</span><span className="text-xs text-muted-foreground">{s.course.code} · {s.status === 'PAUSED' ? 'Paused' : 'Live'}</span></Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const { data: sessionFeed, isFetching: sessionsFetching } = useQuery({ queryKey: ['my-sessions'], queryFn: () => api<{ live: Session[] }>('/sessions'), refetchInterval: 20_000, staleTime: 8_000 });
  if (!user) return null;
  const items = NAV[user.role];
  const live = sessionFeed?.live ?? [];

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <a href="#main" className="skip-link">Skip to main content</a>
      <aside className="sticky top-0 hidden h-dvh flex-col gap-7 border-r border-border bg-surface/95 p-4 md:flex">
        <div className="space-y-1"><Brand /><p className="pl-11 text-[0.65rem] font-semibold uppercase text-muted-foreground">Lecture workspace</p></div>
        <div className="space-y-2">
          <p className="px-3 text-[0.65rem] font-semibold uppercase text-muted-foreground">Workspace</p>
          <NavLinks items={items} />
        </div>
        <div className="mt-auto space-y-3">
          <div className="rounded-md border border-border bg-surface-muted/70 p-3" aria-live="polite">
            <div className="flex items-center gap-2 text-xs font-semibold"><Activity className="h-3.5 w-3.5 text-primary" aria-hidden />Live activity</div>
            <p className="mt-1.5 text-xs text-muted-foreground">{sessionsFetching && !sessionFeed ? 'Checking sessions…' : live.length ? `${live.length} lecture${live.length === 1 ? '' : 's'} in progress` : 'No sessions in progress'}</p>
          </div>
          <div className="flex items-center gap-2 rounded-md px-2 py-2 text-xs text-muted-foreground"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-soft font-semibold text-primary">{initials(user.displayName)}</span><span>Signed in as <span className="font-medium text-foreground">{user.role.toLowerCase()}</span></span></div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-surface/90 px-3 backdrop-blur sm:px-6">
          <Dialog.Root>
            <Dialog.Trigger asChild><Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" aria-hidden /></Button></Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/50" />
              <Dialog.Content aria-describedby={undefined} className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col gap-6 border-r border-border bg-surface p-4 shadow-pop">
                <div className="flex items-center justify-between">
                  <Dialog.Title className="sr-only">Navigation</Dialog.Title>
                  <Brand />
                  <Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="Close navigation"><X className="h-5 w-5" aria-hidden /></Button></Dialog.Close>
                </div>
                <Dialog.Close asChild><div><NavLinks items={items} /></div></Dialog.Close>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <div className="md:hidden"><Brand /></div>
          <Breadcrumbs />
          <div className="hidden items-center gap-2 rounded-full border border-success/25 bg-success-soft px-3 py-1.5 text-xs font-medium text-success sm:flex" role="status" aria-live="polite">
            <span className={cn('h-1.5 w-1.5 rounded-full bg-current', sessionsFetching && 'animate-pulse')} aria-hidden />
            {live.length ? `${live.length} live now` : 'Workspace active'}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
              {theme === 'dark' ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
            </Button>
            <LiveNotifications live={live} isFetching={sessionsFetching} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-2" aria-label="Account menu">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary" aria-hidden>{initials(user.displayName)}</span>
                  <span className="hidden max-w-32 truncate sm:block">{user.displayName}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel><span className="block truncate font-medium text-foreground">{user.displayName}</span><span className="block truncate">{user.email}</span><Badge className="mt-1.5">{user.role.toLowerCase()}</Badge></DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate('/account')}><KeyRound className="h-4 w-4" aria-hidden />Account &amp; password</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => { void logout().then(() => navigate('/login')); }}><LogOut className="h-4 w-4" aria-hidden />Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="app-enter mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

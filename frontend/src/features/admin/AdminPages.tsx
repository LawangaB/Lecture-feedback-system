import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, PasswordInput, Select } from '@/components/ui/form';
import { Table, Td, Th } from '@/components/ui/misc';
import { useAuth } from '@/features/auth/AuthContext';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import type { AdminUser, AuditEvent, Paged, Role } from '@/types/api';

function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-3 flex items-center justify-between text-sm">
      <span className="tabular text-muted-foreground">{total} {total === 1 ? 'result' : 'results'}</span>
      <div className="flex items-center gap-2"><Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button><span className="tabular text-muted-foreground">Page {page} of {pages}</span><Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button></div>
    </div>
  );
}


function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(z.object({ displayName: z.string().trim().min(1, 'Enter a name.').max(100), email: z.string().trim().toLowerCase().email('Enter a valid email.'), role: z.enum(['STUDENT', 'LECTURER', 'ADMIN']), password: z.string().min(10, 'Use at least 10 characters.').max(128) })),
    defaultValues: { displayName: '', email: '', role: 'LECTURER' as Role, password: '' },
  });
  const m = useMutation({
    mutationFn: (v: { displayName: string; email: string; role: Role; password: string }) => api('/admin/users', { method: 'POST', body: v }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin-users'] }); toast.success('Account created.'); form.reset(); onOpenChange(false); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Create account</DialogTitle><DialogDescription>Lecturers and administrators are created here. Share the temporary password securely.</DialogDescription></DialogHeader>
        <form noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => { setError(null); m.mutate(v); })}>
          {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <Field id="u-name" label="Full name" error={form.formState.errors.displayName?.message}>{(p) => <Input {...p} {...form.register('displayName')} />}</Field>
          <Field id="u-email" label="Email" error={form.formState.errors.email?.message}>{(p) => <Input {...p} type="email" {...form.register('email')} />}</Field>
          <Field id="u-role" label="Role">{(p) => <Select {...p} {...form.register('role')}><option value="LECTURER">Lecturer</option><option value="STUDENT">Student</option><option value="ADMIN">Administrator</option></Select>}</Field>
          <Field id="u-pw" label="Temporary password" error={form.formState.errors.password?.message}>{(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register('password')} />}</Field>
          <DialogFooter><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={m.isPending}>Create account</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AdminUsersPage() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<{ user: AdminUser; change: { role?: Role; isActive?: boolean }; text: string; destructive: boolean } | null>(null);
  const qs = new URLSearchParams({ page: String(page), pageSize: '15' });
  if (search.trim()) qs.set('search', search.trim());
  if (role) qs.set('role', role);
  if (status) qs.set('status', status);
  const q = useQuery({ queryKey: ['admin-users', qs.toString()], queryFn: () => api<Paged<AdminUser>>(`/admin/users?${qs}`), placeholderData: (p) => p });
  const apply = async () => {
    await api(`/admin/users/${pending!.user.id}`, { method: 'PATCH', body: pending!.change });
    void qc.invalidateQueries({ queryKey: ['admin-users'] });
    toast.success('Account updated.');
  };
  return (
    <>
      <PageHeader title="Users" description="Search accounts, change roles and deactivate access." actions={<Button onClick={() => setCreating(true)}><UserPlus className="h-4 w-4" aria-hidden />Create account</Button>} />
      <form role="search" className="mb-4 flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()}>
        <Field id="us-q" label="Search" className="min-w-56 flex-1">{(p) => <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden /><Input {...p} className="pl-9" placeholder="Name or email" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} /></div>}</Field>
        <Field id="us-r" label="Role" className="w-40">{(p) => <Select {...p} value={role} onChange={(e) => { setPage(1); setRole(e.target.value); }}><option value="">All roles</option><option value="STUDENT">Students</option><option value="LECTURER">Lecturers</option><option value="ADMIN">Administrators</option></Select>}</Field>
        <Field id="us-s" label="Status" className="w-40">{(p) => <Select {...p} value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}><option value="">All</option><option value="active">Active</option><option value="inactive">Deactivated</option></Select>}</Field>
      </form>
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data!.items.length === 0 ? <EmptyState title="No users match" description="Try a different search or filter." /> : (
        <>
          <Table>
            <caption className="sr-only">User accounts</caption>
            <thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th>Created</Th></tr></thead>
            <tbody>{q.data!.items.map((u) => (
              <tr key={u.id}>
                <Td className="font-medium">{u.displayName}{u.id === me?.id && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}</Td>
                <Td className="text-muted-foreground">{u.email}</Td>
                <Td><label className="sr-only" htmlFor={`role-${u.id}`}>Role for {u.displayName}</label>
                  <Select id={`role-${u.id}`} className="h-8 w-36" value={u.role} disabled={u.id === me?.id} onChange={(e) => { const next = e.target.value as Role; setPending({ user: u, change: { role: next }, text: `Change ${u.displayName} from ${u.role.toLowerCase()} to ${next.toLowerCase()}? Their sessions end immediately and they must sign in again.`, destructive: next === 'ADMIN' || u.role === 'ADMIN' }); }}>
                    <option value="STUDENT">Student</option><option value="LECTURER">Lecturer</option><option value="ADMIN">Administrator</option>
                  </Select></Td>
                <Td><div className="flex items-center gap-2"><Badge tone={u.isActive ? 'success' : 'neutral'}>{u.isActive ? 'Active' : 'Deactivated'}</Badge>
                  <Button variant="ghost" size="sm" disabled={u.id === me?.id} aria-label={`${u.isActive ? 'Deactivate' : 'Reactivate'} ${u.displayName}`} onClick={() => setPending({ user: u, change: { isActive: !u.isActive }, text: u.isActive ? `Deactivate ${u.displayName}? They are signed out everywhere and cannot sign in until reactivated.` : `Reactivate ${u.displayName}?`, destructive: u.isActive })}>{u.isActive ? 'Deactivate' : 'Reactivate'}</Button></div></Td>
                <Td className="text-muted-foreground"><time dateTime={u.createdAt}>{formatDateTime(u.createdAt, { dateStyle: 'medium' })}</time></Td>
              </tr>
            ))}</tbody>
          </Table>
          <Pager page={page} pageSize={15} total={q.data!.total} onPage={setPage} />
        </>
      )}
      <CreateUserDialog open={creating} onOpenChange={setCreating} />
      <ConfirmDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)} title="Confirm account change" description={pending?.text} confirmLabel="Confirm" destructive={pending?.destructive} onConfirm={apply} />
    </>
  );
}

export function AdminAuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const qs = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (action) qs.set('action', action);
  const q = useQuery({ queryKey: ['audit', qs.toString()], queryFn: () => api<Paged<AuditEvent>>(`/admin/audit-events?${qs}`), placeholderData: (p) => p });
  return (
    <>
      <PageHeader title="Audit log" description="Security-relevant actions: sign-ins, role changes, exports and moderation. Poll answers and passwords are never recorded here." />
      <Field id="au-a" label="Event type" className="mb-4 w-56">{(p) => (
        <Select {...p} value={action} onChange={(e) => { setPage(1); setAction(e.target.value); }}>
          <option value="">All events</option><option value="auth.login_failed">Failed sign-ins</option><option value="auth.">Authentication</option><option value="admin.">Administration</option><option value="session.">Sessions</option><option value="poll.">Polls</option><option value="export.">Exports</option><option value="feedback.">Feedback moderation</option>
        </Select>
      )}</Field>
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data!.items.length === 0 ? <EmptyState title="No events" description="Nothing matches this filter yet." /> : (
        <>
          <Table>
            <caption className="sr-only">Audit events</caption>
            <thead><tr><Th>When</Th><Th>Event</Th><Th>Actor</Th><Th>Target</Th><Th>Details</Th></tr></thead>
            <tbody>{q.data!.items.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap text-muted-foreground"><time dateTime={e.at}>{formatDateTime(e.at, { dateStyle: 'short', timeStyle: 'medium' })}</time></Td>
                <Td><code className="text-xs">{e.action}</code></Td>
                <Td>{e.actor ? <><span className="font-medium">{e.actor.displayName}</span><span className="block text-xs text-muted-foreground">{e.actor.email}</span></> : <span className="text-muted-foreground">—</span>}</Td>
                <Td className="text-muted-foreground">{e.targetType ?? '—'}</Td>
                <Td className="max-w-56 truncate text-xs text-muted-foreground">{Object.keys(e.metadata).length ? JSON.stringify(e.metadata) : '—'}</Td>
              </tr>
            ))}</tbody>
          </Table>
          <Pager page={page} pageSize={20} total={q.data!.total} onPage={setPage} />
        </>
      )}
    </>
  );
}

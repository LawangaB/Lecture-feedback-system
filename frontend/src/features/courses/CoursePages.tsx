import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Switch, Table, Td, Th } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/features/auth/AuthContext';
import { SessionCard } from '@/features/sessions/SessionCard';
import { api, errorMessage } from '@/lib/api';
import type { Course, Session } from '@/types/api';

function FormBanner({ error }: { error: string | null }) {
  return error ? <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null;
}

function CreateCourseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(z.object({ code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9-]{1,31}$/, 'Use 2–32 letters, numbers or dashes.'), title: z.string().trim().min(2, 'Enter a title.').max(160), description: z.string().max(2000).optional() })),
    defaultValues: { code: '', title: '', description: '' },
  });
  const m = useMutation({
    mutationFn: (v: { code: string; title: string; description?: string }) => api('/courses', { method: 'POST', body: { ...v, description: v.description || undefined } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['courses'] }); toast.success('Course created.'); form.reset(); onOpenChange(false); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New course</DialogTitle><DialogDescription>You'll be the course lecturer. Add students afterwards.</DialogDescription></DialogHeader>
        <form noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => { setError(null); m.mutate(v); })}>
          <FormBanner error={error} />
          <Field id="c-code" label="Course code" hint="For example CS2040" error={form.formState.errors.code?.message}>{(p) => <Input {...p} className="uppercase" {...form.register('code')} />}</Field>
          <Field id="c-title" label="Title" error={form.formState.errors.title?.message}>{(p) => <Input {...p} {...form.register('title')} />}</Field>
          <Field id="c-desc" label="Description (optional)" error={form.formState.errors.description?.message}>{(p) => <Textarea {...p} {...form.register('description')} />}</Field>
          <DialogFooter><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={m.isPending}>Create course</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CoursesPage() {
  const { user } = useAuth();
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['courses'], queryFn: () => api<{ items: Course[] }>('/courses') });
  const canCreate = user?.role === 'LECTURER' || user?.role === 'ADMIN';
  return (
    <>
      <PageHeader title={user?.role === 'STUDENT' ? 'My courses' : 'Courses'} description={user?.role === 'STUDENT' ? 'Courses you are enrolled in.' : 'Manage courses, enrolments and lecture sessions.'} actions={canCreate ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden />New course</Button> : undefined} />
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data!.items.length === 0 ? (
        <EmptyState icon={<BookOpen className="h-5 w-5" aria-hidden />} title="No courses yet" description={canCreate ? 'Create your first course to start planning lectures.' : 'You are not enrolled in any course. Your lecturer can add you by email.'} action={canCreate ? <Button onClick={() => setCreating(true)}>Create a course</Button> : undefined} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {q.data!.items.map((c) => (
            <Link key={c.id} to={`/courses/${c.id}`} className="group rounded-lg border border-border bg-surface p-5 shadow-card transition-colors hover:border-primary/50">
              <div className="flex items-start justify-between gap-2"><Badge tone="primary">{c.code}</Badge>{c.isArchived && <Badge>Archived</Badge>}</div>
              <h2 className="mt-3 font-semibold group-hover:text-primary">{c.title}</h2>
              <p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground">{c.description ?? 'No description.'}</p>
              <div className="tabular mt-4 flex gap-4 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" aria-hidden />{c.studentCount} students</span><span>{c.sessionCount} sessions</span></div>
            </Link>
          ))}
        </div>
      )}
      <CreateCourseDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function CreateSessionDialog({ courseId, open, onOpenChange }: { courseId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(z.object({ title: z.string().trim().min(2, 'Enter a title.').max(160), description: z.string().max(2000).optional(), scheduledFor: z.string().optional(), accessPolicy: z.enum(['ENROLLED_ONLY', 'ANY_SIGNED_IN']), feedbackEnabled: z.boolean() })),
    defaultValues: { title: '', description: '', scheduledFor: '', accessPolicy: 'ENROLLED_ONLY' as const, feedbackEnabled: true },
  });
  const m = useMutation({
    mutationFn: (v: { title: string; description?: string; scheduledFor?: string; accessPolicy: 'ENROLLED_ONLY' | 'ANY_SIGNED_IN'; feedbackEnabled: boolean }) => api(`/courses/${courseId}/sessions`, { method: 'POST', body: { title: v.title, description: v.description || undefined, scheduledFor: v.scheduledFor ? new Date(v.scheduledFor).toISOString() : undefined, accessPolicy: v.accessPolicy, feedbackEnabled: v.feedbackEnabled } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['course-sessions', courseId] }); toast.success('Session created.'); form.reset(); onOpenChange(false); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New lecture session</DialogTitle><DialogDescription>Start it when you're in the room — students join with a code.</DialogDescription></DialogHeader>
        <form noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => { setError(null); m.mutate(v); })}>
          <FormBanner error={error} />
          <Field id="s-title" label="Title" error={form.formState.errors.title?.message}>{(p) => <Input {...p} placeholder="Week 4 — Transactions" {...form.register('title')} />}</Field>
          <Field id="s-when" label="Scheduled for (optional)">{(p) => <Input {...p} type="datetime-local" {...form.register('scheduledFor')} />}</Field>
          <Field id="s-access" label="Who can join with the code?">{(p) => (
            <Select {...p} {...form.register('accessPolicy')}><option value="ENROLLED_ONLY">Only students enrolled in this course</option><option value="ANY_SIGNED_IN">Any signed-in student with the code</option></Select>
          )}</Field>
          <Controller control={form.control} name="feedbackEnabled" render={({ field }) => (
            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div><label htmlFor="s-fb" className="text-sm font-medium">Collect lecture feedback</label><p className="text-xs text-muted-foreground">Students can rate clarity and pace and leave comments.</p></div>
              <Switch id="s-fb" checked={field.value} onCheckedChange={field.onChange} />
            </div>
          )} />
          <DialogFooter><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={m.isPending}>Create session</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EnrolDialog({ courseId, open, onOpenChange }: { courseId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<'STUDENT' | 'LECTURER'>('STUDENT');
  const [emails, setEmails] = useState('');
  const m = useMutation({
    mutationFn: (list: string[]) => api<{ added: number; notAdded: string[] }>(`/courses/${courseId}/enrolments`, { method: 'POST', body: { emails: list, role } }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['roster', courseId] });
      void qc.invalidateQueries({ queryKey: ['courses'] });
      toast.success(`${r.added} added.${r.notAdded.length ? ` Not added (no active matching account): ${r.notAdded.join(', ')}` : ''}`, { duration: r.notAdded.length ? 9000 : 4000 });
      setEmails(''); onOpenChange(false);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const parse = () => [...new Set(emails.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add people</DialogTitle><DialogDescription>Paste email addresses separated by spaces, commas or new lines. Accounts must already exist.</DialogDescription></DialogHeader>
        <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); setError(null); const list = parse(); if (!list.length) return setError('Enter at least one email address.'); if (list.length > 200) return setError('Add up to 200 people at a time.'); m.mutate(list); }}>
          <FormBanner error={error} />
          <Field id="e-role" label="Add as">{(p) => <Select {...p} value={role} onChange={(e) => setRole(e.target.value as 'STUDENT' | 'LECTURER')}><option value="STUDENT">Student</option><option value="LECTURER">Co-lecturer</option></Select>}</Field>
          <Field id="e-emails" label="Email addresses">{(p) => <Textarea {...p} rows={5} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="student1@university.edu, student2@university.edu" />}</Field>
          <DialogFooter><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={m.isPending}>Add to course</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CourseDetailPage() {
  const { courseId = '' } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [newSession, setNewSession] = useState(false);
  const [enrol, setEnrol] = useState(false);
  const [removing, setRemoving] = useState<{ userId: string; name: string } | null>(null);
  const course = useQuery({ queryKey: ['course', courseId], queryFn: () => api<{ course: Course }>(`/courses/${courseId}`) });
  const sessions = useQuery({ queryKey: ['course-sessions', courseId], queryFn: () => api<{ items: Session[] }>(`/courses/${courseId}/sessions`), enabled: course.isSuccess });
  const canManage = user?.role === 'ADMIN' || user?.role === 'LECTURER';
  const roster = useQuery({ queryKey: ['roster', courseId], queryFn: () => api<{ items: { userId: string; role: string; displayName: string; email: string; isActive: boolean }[] }>(`/courses/${courseId}/enrolments`), enabled: course.isSuccess && canManage, retry: false });
  const isLecturer = canManage && !roster.isError; // roster endpoint 403s for non-managers
  if (course.isLoading) return <LoadingBlock />;
  if (course.isError) return <ErrorState error={course.error} onRetry={() => course.refetch()} title="Course not available" />;
  const c = course.data!.course;
  return (
    <>
      <PageHeader eyebrow={`${c.code} · ${c.ownerName}`} title={c.title} description={c.description ?? undefined} actions={isLecturer && user?.role === 'LECTURER' ? <Button onClick={() => setNewSession(true)}><Plus className="h-4 w-4" aria-hidden />New session</Button> : undefined} />
      <Tabs defaultValue="sessions">
        <TabsList><TabsTrigger value="sessions">Sessions</TabsTrigger>{canManage && <TabsTrigger value="people">People</TabsTrigger>}</TabsList>
        <TabsContent value="sessions">
          {sessions.isLoading ? <LoadingBlock /> : sessions.isError ? <ErrorState error={sessions.error} /> : sessions.data!.items.length === 0 ? (
            <EmptyState title="No sessions yet" description={user?.role === 'LECTURER' ? 'Create a session, then start it when the lecture begins.' : 'Sessions will appear here when your lecturer schedules them.'} action={user?.role === 'LECTURER' ? <Button onClick={() => setNewSession(true)}>Create a session</Button> : undefined} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{sessions.data!.items.map((s) => <SessionCard key={s.id} session={s} showCounts={user?.role !== 'STUDENT'} />)}</div>
          )}
        </TabsContent>
        {canManage && (
          <TabsContent value="people">
            <div className="mb-3 flex items-center justify-between"><p className="text-sm text-muted-foreground">Only lecturers and administrators can see this list.</p><Button variant="secondary" size="sm" onClick={() => setEnrol(true)}><UserPlus className="h-4 w-4" aria-hidden />Add people</Button></div>
            {roster.isLoading ? <LoadingBlock rows={2} /> : roster.isError ? <ErrorState error={roster.error} /> : (
              <Table>
                <caption className="sr-only">Course members</caption>
                <thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
                <tbody>{roster.data!.items.map((m) => (
                  <tr key={m.userId}><Td className="font-medium">{m.displayName}</Td><Td className="text-muted-foreground">{m.email}</Td><Td><Badge tone={m.role === 'LECTURER' ? 'primary' : 'neutral'}>{m.role === 'LECTURER' ? 'Lecturer' : 'Student'}</Badge></Td>
                    <Td className="text-right">{m.role === 'STUDENT' && <Button variant="ghost" size="sm" aria-label={`Remove ${m.displayName}`} onClick={() => setRemoving({ userId: m.userId, name: m.displayName })}><Trash2 className="h-4 w-4" aria-hidden /></Button>}</Td></tr>
                ))}</tbody>
              </Table>
            )}
          </TabsContent>
        )}
      </Tabs>
      <CreateSessionDialog courseId={courseId} open={newSession} onOpenChange={setNewSession} />
      <EnrolDialog courseId={courseId} open={enrol} onOpenChange={setEnrol} />
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title="Remove student?" destructive confirmLabel="Remove"
        description={<>{removing?.name} will lose access to this course and its sessions. Their past answers are kept.</>}
        onConfirm={async () => { await api(`/courses/${courseId}/enrolments/${removing!.userId}`, { method: 'DELETE' }); void qc.invalidateQueries({ queryKey: ['roster', courseId] }); void qc.invalidateQueries({ queryKey: ['courses'] }); toast.success('Student removed.'); }} />
    </>
  );
}

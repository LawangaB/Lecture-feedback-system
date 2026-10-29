import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, PasswordInput } from '@/components/ui/form';
import { useAuth } from '@/features/auth/AuthContext';
import { api, errorMessage, setCsrfToken } from '@/lib/api';
import type { User } from '@/types/api';

export function AccountPage() {
  const { user, setUser } = useAuth();
  const [pwError, setPwError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const profile = useForm({ resolver: zodResolver(z.object({ displayName: z.string().trim().min(1, 'Enter your name.').max(100) })), defaultValues: { displayName: user?.displayName ?? '' } });
  const pw = useForm({
    resolver: zodResolver(z.object({ currentPassword: z.string().min(1, 'Enter your current password.'), newPassword: z.string().min(10, 'Use at least 10 characters.').max(128), confirm: z.string() }).refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match.' })),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });
  return (
    <>
      <PageHeader title="Account" description="Your profile and sign-in security." />
      <div className="grid max-w-3xl gap-6">
        <Card>
          <CardHeader><CardTitle>Profile</CardTitle><CardDescription>{user?.email} · {user?.role.toLowerCase()}</CardDescription></CardHeader>
          <CardContent>
            <form noValidate className="space-y-4" onSubmit={profile.handleSubmit(async (v) => { setNameError(null); try { const r = await api<{ user: User }>('/auth/me', { method: 'PATCH', body: v }); setUser(r.user); toast.success('Profile updated.'); } catch (e) { setNameError(errorMessage(e)); } })}>
              {nameError && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{nameError}</p>}
              <Field id="a-name" label="Display name" error={profile.formState.errors.displayName?.message}>{(p) => <Input {...p} {...profile.register('displayName')} />}</Field>
              <Button type="submit" loading={profile.formState.isSubmitting}>Save profile</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Change password</CardTitle><CardDescription>You'll stay signed in here; other devices are signed out.</CardDescription></CardHeader>
          <CardContent>
            <form noValidate className="space-y-4" onSubmit={pw.handleSubmit(async (v) => {
              setPwError(null);
              try { const r = await api<{ csrfToken: string }>('/auth/change-password', { method: 'POST', body: { currentPassword: v.currentPassword, newPassword: v.newPassword } }); setCsrfToken(r.csrfToken); pw.reset(); toast.success('Password changed.'); } catch (e) { setPwError(errorMessage(e)); }
            })}>
              {pwError && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{pwError}</p>}
              <Field id="a-cur" label="Current password" error={pw.formState.errors.currentPassword?.message}>{(p) => <PasswordInput {...p} autoComplete="current-password" {...pw.register('currentPassword')} />}</Field>
              <Field id="a-new" label="New password" hint="At least 10 characters." error={pw.formState.errors.newPassword?.message}>{(p) => <PasswordInput {...p} autoComplete="new-password" {...pw.register('newPassword')} />}</Field>
              <Field id="a-conf" label="Confirm new password" error={pw.formState.errors.confirm?.message}>{(p) => <PasswordInput {...p} autoComplete="new-password" {...pw.register('confirm')} />}</Field>
              <Button type="submit" loading={pw.formState.isSubmitting}>Update password</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input, PasswordInput } from '@/components/ui/form';
import { api, ApiError, errorMessage } from '@/lib/api';
import { AuthLayout } from './AuthLayout';
import { useAuth } from './AuthContext';

const email = z.string().trim().toLowerCase().email('Enter a valid email address.').max(254);
const newPassword = z.string().min(10, 'Use at least 10 characters.').max(128, 'Use at most 128 characters.');
const FormError = ({ message }: { message: string | null }) => (message ? <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{message}</p> : null);

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [error, setError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(z.object({ email, password: z.string().min(1, 'Enter your password.') })), defaultValues: { email: '', password: '' } });
  if (user) return <Navigate to={from} replace />;
  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your lectures, polls and feedback.">
      <form noValidate className="space-y-4" onSubmit={form.handleSubmit(async (v) => {
        setError(null);
        try { await login(v.email, v.password); navigate(from, { replace: true }); } catch (e) { setError(errorMessage(e)); }
      })}>
        <FormError message={error} />
        <Field id="email" label="Email" error={form.formState.errors.email?.message}>{(p) => <Input {...p} type="email" autoComplete="email" inputMode="email" {...form.register('email')} />}</Field>
        <Field id="password" label="Password" error={form.formState.errors.password?.message}>{(p) => <PasswordInput {...p} autoComplete="current-password" {...form.register('password')} />}</Field>
        <div className="flex justify-end"><Link to="/forgot-password" className="text-sm text-primary hover:underline">Forgot password?</Link></div>
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>Sign in</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">New student? <Link to="/register" className="font-medium text-primary hover:underline">Create an account</Link></p>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(z.object({ displayName: z.string().trim().min(1, 'Enter your name.').max(100), email, password: newPassword, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match.' })),
    defaultValues: { displayName: '', email: '', password: '', confirm: '' },
  });
  if (user) return <Navigate to="/" replace />;
  return (
    <AuthLayout title="Create your account" subtitle="Student accounts are self-service. Lecturers are set up by an administrator.">
      <form noValidate className="space-y-4" onSubmit={form.handleSubmit(async (v) => {
        setError(null);
        try { await register(v.email, v.password, v.displayName); navigate('/', { replace: true }); } catch (e) { setError(errorMessage(e)); }
      })}>
        <FormError message={error} />
        <Field id="name" label="Full name" error={form.formState.errors.displayName?.message}>{(p) => <Input {...p} autoComplete="name" {...form.register('displayName')} />}</Field>
        <Field id="email" label="Email" error={form.formState.errors.email?.message}>{(p) => <Input {...p} type="email" autoComplete="email" inputMode="email" {...form.register('email')} />}</Field>
        <Field id="password" label="Password" hint="At least 10 characters. A passphrase works well." error={form.formState.errors.password?.message}>{(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register('password')} />}</Field>
        <Field id="confirm" label="Confirm password" error={form.formState.errors.confirm?.message}>{(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register('confirm')} />}</Field>
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>Create account</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">Already registered? <Link to="/login" className="font-medium text-primary hover:underline">Sign in</Link></p>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(z.object({ email })), defaultValues: { email: '' } });
  return (
    <AuthLayout title="Reset your password" subtitle="Enter your email and we'll send a reset link if an account exists.">
      {sent ? (
        <div role="status" className="space-y-4 rounded-md bg-success-soft p-4 text-sm">
          <p className="font-medium text-success">Check your inbox</p>
          <p>If an account exists for that address, a reset link is on its way. It expires in 30 minutes.</p>
          <Link to="/login" className="font-medium text-primary hover:underline">Back to sign in</Link>
        </div>
      ) : (
        <form noValidate className="space-y-4" onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try { await api('/auth/forgot-password', { method: 'POST', body: v }); setSent(true); } catch (e) { setError(errorMessage(e)); }
        })}>
          <FormError message={error} />
          <Field id="email" label="Email" error={form.formState.errors.email?.message}>{(p) => <Input {...p} type="email" autoComplete="email" {...form.register('email')} />}</Field>
          <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>Send reset link</Button>
          <p className="text-center text-sm"><Link to="/login" className="text-primary hover:underline">Back to sign in</Link></p>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(z.object({ newPassword, confirm: z.string() }).refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match.' })),
    defaultValues: { newPassword: '', confirm: '' },
  });
  if (!token) return <AuthLayout title="Link not valid"><p className="text-sm">This reset link is missing its token. <Link className="text-primary hover:underline" to="/forgot-password">Request a new one</Link>.</p></AuthLayout>;
  return (
    <AuthLayout title="Choose a new password" subtitle="Signing in on other devices will be ended.">
      <form noValidate className="space-y-4" onSubmit={form.handleSubmit(async (v) => {
        setError(null);
        try { await api('/auth/reset-password', { method: 'POST', body: { token, newPassword: v.newPassword } }); toast.success('Password updated. Please sign in.'); navigate('/login', { replace: true }); } catch (e) { setError(e instanceof ApiError && e.code === 'INVALID_RESET_TOKEN' ? 'This link is invalid or has expired. Request a new one.' : errorMessage(e)); }
      })}>
        <FormError message={error} />
        <Field id="np" label="New password" hint="At least 10 characters." error={form.formState.errors.newPassword?.message}>{(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register('newPassword')} />}</Field>
        <Field id="cp" label="Confirm new password" error={form.formState.errors.confirm?.message}>{(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register('confirm')} />}</Field>
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>Update password</Button>
      </form>
    </AuthLayout>
  );
}

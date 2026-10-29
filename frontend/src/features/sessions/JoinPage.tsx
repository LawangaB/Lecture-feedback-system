import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { QrCode } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';
import type { Session } from '@/types/api';

/** Single field, one action: the shortest path from "I have a code" to "I'm in the lecture". */
export function JoinForm({ initialCode = '', autoSubmit = false, buttonVariant = 'primary' }: { initialCode?: string; autoSubmit?: boolean; buttonVariant?: 'primary' | 'secondary' }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(z.object({ code: z.string().trim().min(4, 'Enter the code shown on the lecturer\u2019s screen.').max(16) })), defaultValues: { code: initialCode } });
  const submit = form.handleSubmit(async ({ code }) => {
    setError(null);
    try {
      const { session } = await api<{ session: Session }>('/sessions/join', { method: 'POST', body: { code } });
      void qc.invalidateQueries({ queryKey: ['my-sessions'] });
      navigate(`/sessions/${session.id}`);
    } catch (e) { setError(errorMessage(e)); }
  });
  const fired = useRef(false);
  useEffect(() => { if (autoSubmit && initialCode && !fired.current) { fired.current = true; void submit(); } }, [autoSubmit, initialCode, submit]);
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div className="flex-1">
        <Field id="join-code" label="Session code" error={form.formState.errors.code?.message ?? error ?? undefined} className="[&>label]:sr-only">
          {(p) => <Input {...p} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="e.g. AB7KQ9" className="h-12 text-center text-lg font-semibold uppercase tracking-[0.3em]" maxLength={16} {...form.register('code')} />}
        </Field>
      </div>
      <Button type="submit" variant={buttonVariant} size="lg" className="sm:w-36" loading={form.formState.isSubmitting}>Join lecture</Button>
    </form>
  );
}

export function JoinPage() {
  const [params] = useSearchParams();
  const code = params.get('code') ?? '';
  return (
    <>
      <PageHeader title="Join a lecture" description={code ? 'Joining with the code from the QR link…' : 'Type the code from the lecturer\u2019s screen.'} />
      <Card className="max-w-xl">
        <CardContent className="space-y-4 pt-5">
          <JoinForm initialCode={code} autoSubmit={Boolean(code)} />
          <p className="flex items-start gap-2 text-sm text-muted-foreground"><QrCode className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Prefer the QR code? Open your phone's camera, point it at the code on screen, and tap the link. You'll land here already filled in.</p>
        </CardContent>
      </Card>
    </>
  );
}

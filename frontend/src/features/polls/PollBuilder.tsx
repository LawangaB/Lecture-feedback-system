import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, GripVertical, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Switch } from '@/components/ui/misc';
import { api, ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Poll } from '@/types/api';

const schema = z
  .object({
    question: z.string().trim().min(3, 'Ask a question of at least 3 characters.').max(500),
    type: z.enum(['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'RATING']),
    options: z.array(z.object({ label: z.string().trim().max(300) })).max(10),
    minSelections: z.coerce.number().int().min(0).max(10),
    maxSelections: z.coerce.number().int().min(1).max(10),
    ratingMax: z.coerce.number().int().min(2).max(10),
    durationSeconds: z.coerce.number().int().min(0).max(3600),
    isAnonymous: z.boolean(),
    allowResponseUpdate: z.boolean(),
    isRequired: z.boolean(),
    resultsVisibility: z.enum(['HIDDEN', 'LIVE', 'AFTER_CLOSE']),
  })
  .superRefine((v, ctx) => {
    if (v.type !== 'RATING') {
      const labels = v.options.map((o) => o.label.trim());
      v.options.forEach((o, i) => { if (!o.label.trim()) ctx.addIssue({ code: 'custom', path: ['options', i, 'label'], message: 'Option text is required.' }); });
      if (labels.filter(Boolean).length < 2) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Add at least two answer options.' });
      const seen = new Set<string>();
      labels.forEach((l, i) => { const k = l.toLowerCase(); if (l && seen.has(k)) ctx.addIssue({ code: 'custom', path: ['options', i, 'label'], message: 'Options must be unique.' }); seen.add(k); });
    }
    if (v.type === 'MULTIPLE_CHOICE') {
      if (v.minSelections > v.maxSelections) ctx.addIssue({ code: 'custom', path: ['minSelections'], message: 'Minimum cannot exceed maximum.' });
      if (v.maxSelections > v.options.length) ctx.addIssue({ code: 'custom', path: ['maxSelections'], message: 'Maximum cannot exceed the number of options.' });
    }
  });
type Values = z.infer<typeof schema>;

const TYPE_LABEL = { SINGLE_CHOICE: 'Single choice', MULTIPLE_CHOICE: 'Multiple select', RATING: 'Rating scale' } as const;
const DURATIONS = [[0, 'No time limit'], [30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes'], [600, '10 minutes']] as const;

function toValues(p?: Poll): Values {
  return {
    question: p?.question ?? '', type: p?.type ?? 'SINGLE_CHOICE',
    options: p && p.type !== 'RATING' ? p.options.map((o) => ({ label: o.label })) : [{ label: '' }, { label: '' }],
    minSelections: p?.minSelections ?? 1, maxSelections: p?.maxSelections ?? 2, ratingMax: p?.ratingMax ?? 5, durationSeconds: p?.durationSeconds ?? 0,
    isAnonymous: p?.isAnonymous ?? true, allowResponseUpdate: p?.allowResponseUpdate ?? false, isRequired: p?.isRequired ?? false, resultsVisibility: p?.resultsVisibility ?? 'AFTER_CLOSE',
  };
}

function StudentPreview({ v }: { v: Values }) {
  const opts = v.options.map((o) => o.label.trim()).filter(Boolean);
  return (
    <div className="rounded-lg border border-border bg-surface-muted p-4" aria-label="Student preview">
      <p className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"><Eye className="h-3.5 w-3.5" aria-hidden />What students will see</p>
      <p className="font-medium">{v.question || 'Your question appears here'}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {v.type === 'MULTIPLE_CHOICE' ? `Choose ${v.minSelections}–${v.maxSelections}` : v.type === 'RATING' ? `Rate from 1 to ${v.ratingMax}` : 'Choose one'}
        {v.durationSeconds > 0 ? ` · ${v.durationSeconds >= 60 ? `${v.durationSeconds / 60} min` : `${v.durationSeconds}s`} to answer` : ''}
        {v.isAnonymous ? ' · Anonymous' : ' · Your name is recorded'}
      </p>
      <div className="mt-3 space-y-2" aria-hidden>
        {v.type === 'RATING'
          ? <div className="flex gap-2">{Array.from({ length: v.ratingMax }, (_, i) => <span key={i} className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface text-sm">{i + 1}</span>)}</div>
          : (opts.length ? opts : ['Option A', 'Option B']).map((o, i) => <div key={i} className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2.5 text-sm"><span className={cn('h-4 w-4 shrink-0 border border-muted-foreground', v.type === 'MULTIPLE_CHOICE' ? 'rounded-sm' : 'rounded-full')} />{o}</div>)}
      </div>
    </div>
  );
}

export function PollBuilderDialog({ sessionId, poll, open, onOpenChange }: { sessionId: string; poll?: Poll; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        {/* Radix unmounts the content when closed, so the form starts fresh (no reset effect needed). */}
        <BuilderForm sessionId={sessionId} poll={poll} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function BuilderForm({ sessionId, poll, onOpenChange }: { sessionId: string; poll?: Poll; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema) as never, defaultValues: toValues(poll) });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'options' });
  const v = useWatch({ control: form.control }) as Values;
  const type = v.type;

  const m = useMutation({
    mutationFn: (x: Values) => {
      const body = {
        question: x.question, type: x.type, isAnonymous: x.isAnonymous, allowResponseUpdate: x.isAnonymous ? false : x.allowResponseUpdate, isRequired: x.isRequired, resultsVisibility: x.resultsVisibility,
        options: x.type === 'RATING' ? [] : x.options.map((o) => o.label.trim()),
        ...(x.type === 'MULTIPLE_CHOICE' ? { minSelections: x.minSelections, maxSelections: x.maxSelections } : {}),
        ...(x.type === 'RATING' ? { ratingMin: 1, ratingMax: x.ratingMax } : {}),
        durationSeconds: x.durationSeconds > 0 ? x.durationSeconds : null,
      };
      return poll ? api(`/polls/${poll.id}`, { method: 'PUT', body }) : api(`/sessions/${sessionId}/polls`, { method: 'POST', body });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['session', sessionId] }); toast.success(poll ? 'Draft updated.' : 'Poll saved as a draft.'); onOpenChange(false); },
    onError: (e) => {
      if (e instanceof ApiError && e.fields?.length) setError(e.fields.map((f) => f.message).join(' '));
      else setError(errorMessage(e));
    },
  });

  return (
    <>
        <DialogHeader><DialogTitle>{poll ? 'Edit draft poll' : 'New poll'}</DialogTitle><DialogDescription>Save it as a draft now, launch it when you're ready.</DialogDescription></DialogHeader>
        <form noValidate onSubmit={form.handleSubmit((x) => { setError(null); m.mutate(x); })} className="grid gap-6 md:grid-cols-[1.25fr_1fr]">
          <div className="space-y-4">
            {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
            <Field id="p-q" label="Question" error={form.formState.errors.question?.message}>{(p) => <Textarea {...p} rows={2} maxLength={500} placeholder="Which normal form removes partial dependencies?" {...form.register('question')} />}</Field>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Question type</legend>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Question type">
                {(Object.keys(TYPE_LABEL) as (keyof typeof TYPE_LABEL)[]).map((t) => (
                  <label key={t} className={cn('cursor-pointer rounded-md border px-2 py-2.5 text-center text-sm font-medium has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring', type === t ? 'border-primary bg-primary-soft text-primary' : 'border-border hover:bg-surface-muted')}>
                    <input type="radio" value={t} className="sr-only" {...form.register('type')} />{TYPE_LABEL[t]}
                  </label>
                ))}
              </div>
            </fieldset>

            {type !== 'RATING' && (
              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-medium">Answer options</legend>
                {fields.map((f, i) => (
                  <div key={f.id} className="flex items-start gap-2">
                    <GripVertical className="mt-2.5 h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden />
                    <div className="flex-1">
                      <Input aria-label={`Option ${i + 1}`} aria-invalid={form.formState.errors.options?.[i]?.label ? true : undefined} placeholder={`Option ${i + 1}`} maxLength={300} {...form.register(`options.${i}.label`)} />
                      {form.formState.errors.options?.[i]?.label && <p role="alert" className="mt-1 text-xs font-medium text-danger">{form.formState.errors.options[i]!.label!.message}</p>}
                    </div>
                    <Button variant="ghost" size="icon" aria-label={`Remove option ${i + 1}`} disabled={fields.length <= 2} onClick={() => remove(i)}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                  </div>
                ))}
                {typeof form.formState.errors.options?.message === 'string' && <p role="alert" className="text-xs font-medium text-danger">{form.formState.errors.options.message}</p>}
                {fields.length < 10 && <Button variant="soft" size="sm" onClick={() => append({ label: '' })}><Plus className="h-4 w-4" aria-hidden />Add option</Button>}
              </fieldset>
            )}

            {type === 'MULTIPLE_CHOICE' && (
              <div className="grid grid-cols-2 gap-3">
                <Field id="p-min" label="Minimum selections" error={form.formState.errors.minSelections?.message}>{(p) => <Input {...p} type="number" min={0} max={10} {...form.register('minSelections')} />}</Field>
                <Field id="p-max" label="Maximum selections" error={form.formState.errors.maxSelections?.message}>{(p) => <Input {...p} type="number" min={1} max={10} {...form.register('maxSelections')} />}</Field>
              </div>
            )}
            {type === 'RATING' && <Field id="p-rmax" label="Scale" hint="Students pick a whole number from 1 up to this value.">{(p) => <Select {...p} {...form.register('ratingMax')}>{[3, 4, 5, 7, 10].map((n) => <option key={n} value={n}>1 to {n}</option>)}</Select>}</Field>}

            <Field id="p-dur" label="Time limit">{(p) => <Select {...p} {...form.register('durationSeconds')}>{DURATIONS.map(([s, l]) => <option key={s} value={s}>{l}</option>)}</Select>}</Field>
            <Field id="p-vis" label="Who sees results?" hint="You always see live results. Students see them according to this setting.">{(p) => (
              <Select {...p} {...form.register('resultsVisibility')}>
                <option value="AFTER_CLOSE">Students see results after the poll closes</option><option value="LIVE">Students see results live</option><option value="HIDDEN">Hidden until I reveal them</option>
              </Select>
            )}</Field>

            <div className="space-y-3 rounded-md border border-border p-3">
              <Controller control={form.control} name="isAnonymous" render={({ field }) => (
                <div className="flex items-start justify-between gap-4"><div><label htmlFor="p-anon" className="text-sm font-medium">Anonymous responses</label><p className="text-xs text-muted-foreground">Answers are stored with no link to the student. Answers cannot be changed later.</p></div><Switch id="p-anon" checked={field.value} onCheckedChange={(c) => { field.onChange(c); if (c) form.setValue('allowResponseUpdate', false); }} /></div>
              )} />
              <Controller control={form.control} name="allowResponseUpdate" render={({ field }) => (
                <div className="flex items-start justify-between gap-4"><div><label htmlFor="p-upd" className="text-sm font-medium">Allow students to change their answer</label><p className="text-xs text-muted-foreground">Only available when responses are identified.</p></div><Switch id="p-upd" checked={field.value && !v.isAnonymous} disabled={v.isAnonymous} onCheckedChange={field.onChange} /></div>
              )} />
              <Controller control={form.control} name="isRequired" render={({ field }) => (
                <div className="flex items-start justify-between gap-4"><div><label htmlFor="p-req" className="text-sm font-medium">Mark as required</label><p className="text-xs text-muted-foreground">Flags this poll as one every student is expected to answer.</p></div><Switch id="p-req" checked={field.value} onCheckedChange={field.onChange} /></div>
              )} />
            </div>
          </div>
          <div className="space-y-4"><StudentPreview v={v} /></div>
          <DialogFooter className="md:col-span-2"><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={m.isPending}>{poll ? 'Save changes' : 'Save draft'}</Button></DialogFooter>
        </form>
    </>
  );
}

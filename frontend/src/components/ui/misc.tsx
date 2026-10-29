import * as ProgressPrimitive from '@radix-ui/react-progress';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as React from 'react';
import { cn } from '@/lib/utils';

export const Skeleton = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div aria-hidden className={cn('animate-pulse rounded-md bg-surface-muted', className)} {...p} />;

export const Switch = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(({ className, ...p }, ref) => (
  <SwitchPrimitive.Root ref={ref} className={cn('peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-border transition-colors data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-50', className)} {...p}>
    <SwitchPrimitive.Thumb className="pointer-events-none block h-5 w-5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';

export function Progress({ value, className, label }: { value: number; className?: string; label: string }) {
  return (
    <ProgressPrimitive.Root value={value} aria-label={label} className={cn('relative h-2 w-full overflow-hidden rounded-full bg-surface-muted', className)}>
      <ProgressPrimitive.Indicator className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </ProgressPrimitive.Root>
  );
}

export const Table = ({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) => (
  <div className="w-full overflow-x-auto rounded-md border border-border" tabIndex={0} role="region" aria-label="Scrollable table">
    <table className={cn('w-full min-w-[36rem] text-left text-sm', className)} {...p} />
  </div>
);
export const Th = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => <th scope="col" className={cn('whitespace-nowrap bg-surface-muted px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground', className)} {...p} />;
export const Td = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn('border-t border-border px-4 py-3 align-middle', className)} {...p} />;

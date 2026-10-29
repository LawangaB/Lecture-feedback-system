import * as T from '@radix-ui/react-tabs';
import * as React from 'react';
import { cn } from '@/lib/utils';

export const Tabs = T.Root;
export const TabsList = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof T.List>>(({ className, ...p }, ref) => (
  <T.List ref={ref} className={cn('inline-flex h-10 items-center gap-1 rounded-md bg-surface-muted p-1', className)} {...p} />
));
TabsList.displayName = 'TabsList';
export const TabsTrigger = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<typeof T.Trigger>>(({ className, ...p }, ref) => (
  <T.Trigger ref={ref} className={cn('inline-flex h-8 items-center justify-center gap-1.5 rounded-sm px-3 text-sm font-medium text-muted-foreground data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:shadow-card', className)} {...p} />
));
TabsTrigger.displayName = 'TabsTrigger';
export const TabsContent = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof T.Content>>(({ className, ...p }, ref) => (
  <T.Content ref={ref} className={cn('mt-4', className)} {...p} />
));
TabsContent.displayName = 'TabsContent';

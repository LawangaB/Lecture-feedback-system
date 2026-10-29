import { BarChart3, MessageSquareText, ShieldCheck, Zap } from 'lucide-react';
import type { ReactNode } from 'react';

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[1.05fr_1fr]">
      <a href="#main" className="skip-link">Skip to main content</a>
      <aside className="auth-visual-panel relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="relative z-10 flex items-center gap-2.5 font-semibold"><span className="flex h-9 w-9 items-center justify-center rounded-md border border-white/20 bg-white/15 backdrop-blur-sm"><BarChart3 className="h-5 w-5" aria-hidden /></span>Lecture Feedback</div>
        <div>
          <h2 className="relative z-10 max-w-md text-4xl font-semibold leading-tight">See understanding as it happens.</h2>
          <p className="relative z-10 mt-4 max-w-md text-white/80">Run live polls, gather honest feedback and field questions — from every seat in the room, on any device.</p>
          <ul className="relative z-10 mt-10 space-y-4 text-sm text-white/90">
            <li className="flex items-center gap-3"><Zap className="h-4 w-4 text-[#ffb58f]" aria-hidden />Answers appear on your screen in seconds</li>
            <li className="flex items-center gap-3"><ShieldCheck className="h-4 w-4 text-[#ffb58f]" aria-hidden />Anonymous polls store no link to the student</li>
            <li className="flex items-center gap-3"><MessageSquareText className="h-4 w-4 text-[#ffb58f]" aria-hidden />Feedback you control: who sees what, and when</li>
          </ul>
        </div>
        <p className="relative z-10 text-xs text-white/65">Built for lecturers and students.</p>
      </aside>
      <main id="main" tabIndex={-1} className="flex min-h-dvh items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 font-semibold lg:hidden"><span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground"><BarChart3 className="h-4 w-4" aria-hidden /></span>Lecture Feedback</div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  );
}

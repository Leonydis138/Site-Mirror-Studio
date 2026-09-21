import { type ReactNode } from 'react';
import { History, Network, Plus, ShieldCheck, Waypoints } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import type { MirrorJob } from '@workspace/api-client-react';

export function SiteMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]">
        <Network className="h-[18px] w-[18px]" strokeWidth={2.4} />
        <span className="signal-dot absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[hsl(var(--card))]" />
      </span>
      {!compact && (
        <span>
          <span className="block text-[15px] font-extrabold tracking-[-.04em]">site mirror</span>
          <span className="font-mono text-[9px] uppercase tracking-[.2em] text-[hsl(var(--sidebar-foreground)/.53)]">archive operations</span>
        </span>
      )}
    </div>
  );
}

export function AppShell({ children, active = 'new', eyebrow = 'Control room' }: { children: ReactNode; active?: 'new' | 'history'; eyebrow?: string }) {
  const [location] = useLocation();
  const current = location === '/history' ? 'history' : active;
  return (
    <div className="noise-overlay min-h-[100dvh] bg-[hsl(var(--background))]">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[248px] flex-col justify-between bg-[hsl(var(--sidebar))] px-5 py-6 text-[hsl(var(--sidebar-foreground))] md:flex">
        <div>
          <SiteMark />
          <nav aria-label="Primary navigation" className="mt-14 space-y-1">
            <p className="mb-3 px-3 font-mono text-[9px] uppercase tracking-[.22em] text-[hsl(var(--sidebar-foreground)/.45)]">Workspace</p>
            <Link href="/" data-testid="link-nav-new-mirror" className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition-colors ${current === 'new' ? 'bg-[hsl(var(--sidebar-accent))] text-[hsl(var(--sidebar-foreground))]' : 'text-[hsl(var(--sidebar-foreground)/.68)] hover:bg-[hsl(var(--sidebar-accent)/.7)] hover:text-[hsl(var(--sidebar-foreground))]'}`}>
              <Plus className="h-4 w-4 text-[hsl(var(--accent))]" />New mirror
            </Link>
            <Link href="/history" data-testid="link-nav-history" className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition-colors ${current === 'history' ? 'bg-[hsl(var(--sidebar-accent))] text-[hsl(var(--sidebar-foreground))]' : 'text-[hsl(var(--sidebar-foreground)/.68)] hover:bg-[hsl(var(--sidebar-accent)/.7)] hover:text-[hsl(var(--sidebar-foreground))]'}`}>
              <History className="h-4 w-4" />Job history
            </Link>
          </nav>
          <div className="mt-10 border-t border-[hsl(var(--sidebar-border))] pt-7">
            <p className="mb-4 px-3 font-mono text-[9px] uppercase tracking-[.22em] text-[hsl(var(--sidebar-foreground)/.45)]">Trust boundary</p>
            <div className="space-y-4 px-3 text-xs leading-5 text-[hsl(var(--sidebar-foreground)/.66)]">
              <p className="flex gap-2.5"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--accent))]" />Permission-first by design</p>
              <p className="flex gap-2.5"><Waypoints className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--accent))]" />Same-origin crawl scope</p>
              <p className="flex gap-2.5"><Network className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--accent))]" />Playable isolated previews</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent)/.52)] p-3.5">
          <p className="font-mono text-[9px] uppercase tracking-[.18em] text-[hsl(var(--accent))]">Operator note</p>
          <p className="mt-2 text-[11px] leading-4 text-[hsl(var(--sidebar-foreground)/.6)]">Only archive sites you own or have explicit permission to copy.</p>
        </div>
      </aside>
      <div className="md:ml-[248px]">
        <header className="sticky top-0 z-10 flex min-h-[64px] items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--background)/.9)] px-5 backdrop-blur md:px-10">
          <div className="md:hidden"><SiteMark compact /></div>
          <div className="hidden items-center gap-2 text-xs text-[hsl(var(--muted-foreground))] md:flex"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent-border))]" />{eyebrow}</div>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))]"><span className="hidden sm:inline">local archive protocol</span><span className="h-1 w-1 rounded-full bg-[hsl(var(--accent))]" />ready</div>
        </header>
        {children}
      </div>
    </div>
  );
}

const statusLabels: Record<MirrorJob['status'], string> = {
  queued: 'Queued',
  running: 'Mirroring',
  completed: 'Complete',
  completed_with_warnings: 'Warnings',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function StatusBadge({ status }: { status: MirrorJob['status'] }) {
  const tones: Record<MirrorJob['status'], string> = {
    queued: 'bg-[hsl(var(--accent)/.2)] text-[hsl(var(--accent-foreground))]',
    running: 'bg-[hsl(var(--secondary))] text-[hsl(175_40%_25%)]',
    completed: 'bg-[hsl(175_42%_76%/.6)] text-[hsl(175_40%_25%)]',
    completed_with_warnings: 'bg-[hsl(35_82%_67%/.38)] text-[hsl(28_67%_30%)]',
    failed: 'bg-[hsl(var(--destructive)/.12)] text-[hsl(var(--destructive))]',
    cancelled: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
  };
  return <span data-testid="status-badge" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[.12em] ${tones[status]}`}><span className={`h-1.5 w-1.5 rounded-full bg-current ${status === 'running' ? 'signal-dot' : ''}`} />{statusLabels[status]}</span>;
}

export function PageIntro({ kicker, title, body, action }: { kicker: string; title: string; body: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-[hsl(var(--accent-border))]">{kicker}</p><h1 className="mt-2 max-w-3xl text-3xl font-extrabold tracking-[-.055em] md:text-5xl">{title}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-[hsl(var(--muted-foreground))]">{body}</p></div>{action}</div>;
}
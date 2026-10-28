'use client';

import { cn } from '@/lib/utils';

export function SectionTitle({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-base font-semibold text-text">
        <span className="grid size-8 place-items-center rounded-lg bg-primary-soft text-primary-soft-fg">
          <Icon className="size-4" />
        </span>
        {title}
      </h2>
      {children}
    </div>
  );
}

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        'proto-panel rounded-2xl border border-border bg-surface p-4 shadow-[0_1px_3px_rgba(16,40,24,0.06)] sm:p-5',
        className,
      )}
      {...props}
    />
  );
}

export function ago(at: number | null, now: number): string {
  if (at === null) return 'Never';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 2) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`;
}

import { type ReactNode } from "react";

export function Section({
  title,
  children,
  meta,
}: {
  title: string;
  children: ReactNode;
  meta?: string;
}) {
  return (
    <section className="border border-cyber-cyan/10 bg-cyber-bg/50 p-5">
      <div className="border-b border-cyber-cyan/10 pb-2 mb-4 flex items-center gap-2">
        <h3 className="text-cyber-cyan/70 text-sm tracking-[0.15em] uppercase">
          &#9656; {title}
        </h3>
        {meta && (
          <span className="text-cyber-cyan/30 text-[10px] tracking-[0.08em]">
            {meta}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

// Fixed widths instead of Math.random(): a random value during render changes
// on every re-render, so the skeleton bars twitched while loading.
const SKELETON_WIDTHS = [92, 68, 84, 74, 96, 62, 88, 78, 70, 90];

export function LoadingPlaceholder({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2 animate-pulse">
      {SKELETON_WIDTHS.slice(0, rows).map((width, i) => (
        <div
          key={`${i}-${width}`}
          className="h-4 bg-cyber-cyan/5 rounded"
          style={{ width: `${width}%` }}
        />
      ))}
    </div>
  );
}

export function EmptyState({ message = "No data yet" }: { message?: string }) {
  return (
    <p className="text-cyber-cyan/30 text-sm tracking-[0.1em] uppercase">
      {message}
    </p>
  );
}

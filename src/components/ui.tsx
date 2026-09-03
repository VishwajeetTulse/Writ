import type { ReactNode } from "react";

/** Layout primitives. Small on purpose — the console is mostly tables and one bar. */

export function Page({
  title,
  lede,
  actions,
  children,
  wide = false,
}: {
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`mx-auto px-6 py-8 ${wide ? "max-w-[1400px]" : "max-w-[1080px]"}`}>
      <div className="mb-7 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{title}</h1>
          {lede && (
            <p className="mt-1.5 max-w-[62ch] text-[14px] leading-relaxed text-ink-mute">
              {lede}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Card({
  children,
  className = "",
  pad = true,
}: {
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section
      className={`rounded-lg border border-line bg-surface ${pad ? "p-5" : ""} ${className}`}
    >
      {children}
    </section>
  );
}

export function Field({
  label,
  children,
  mono = true,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="eyebrow mb-1">{label}</div>
      <div className={`text-[13px] tnum ${mono ? "font-mono" : ""}`}>{children}</div>
    </div>
  );
}

/** A single headline number. The label sits above it, small and quiet. */
export function Stat({
  label,
  value,
  sub,
  tone = "ink",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "ink" | "permit" | "deny" | "mute";
}) {
  const toneClass = {
    ink: "text-ink",
    permit: "text-permit",
    deny: "text-deny",
    mute: "text-ink-mute",
  }[tone];

  return (
    <div>
      <div className="eyebrow mb-1.5">{label}</div>
      <div className={`font-mono text-[26px] leading-none tnum ${toneClass}`}>{value}</div>
      {sub && <div className="mt-2 text-[12px] leading-snug text-ink-mute">{sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong bg-surface px-6 py-12 text-center text-[13px] text-ink-mute">
      {children}
    </div>
  );
}

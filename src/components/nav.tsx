"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Mandates" },
  { href: "/run", label: "Agent run" },
  { href: "/ledger", label: "Ledger" },
  { href: "/impact", label: "Spending" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-8 px-6">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-[17px] font-semibold tracking-[-0.02em]">Writ</span>
          <span className="eyebrow hidden sm:inline">spending authority</span>
        </Link>

        <nav className="flex items-center gap-1">
          {LINKS.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/" || pathname.startsWith("/mandates")
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded px-3 py-1.5 text-[13px] transition-colors ${
                  active
                    ? "bg-ground font-medium text-ink"
                    : "text-ink-mute hover:text-ink"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Stated, not hidden. Every rupee in this console is Razorpay test mode. */}
        <span className="ml-auto rounded border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-mute">
          Razorpay test mode
        </span>
      </div>
    </header>
  );
}

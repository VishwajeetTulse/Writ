"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Mandates", open: false },
  { href: "/catalog", label: "Catalog", open: true },
  { href: "/run", label: "Activity", open: false },
  { href: "/ledger", label: "Ledger", open: false },
  { href: "/impact", label: "Spending", open: false },
];

export interface NavUser {
  name: string | null;
  email: string | null;
  image: string | null;
}

export function Nav({
  user,
  signOutAction,
}: {
  user: NavUser | null;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();

  // Signed out, the only destination that would not bounce straight back to sign-in is
  // the catalog — and that one is meant to be readable cold, by a person or an agent.
  const links = user ? LINKS : LINKS.filter((link) => link.open);

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 overflow-x-auto px-6">
        <Link href="/" className="flex shrink-0 items-baseline gap-2">
          <span className="text-[17px] font-semibold tracking-[-0.02em]">Writ</span>
          <span className="eyebrow hidden sm:inline">spending authority</span>
        </Link>

        <nav className="flex shrink-0 items-center gap-1">
          {links.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/" || pathname.startsWith("/mandates")
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`whitespace-nowrap rounded px-3 py-1.5 text-[13px] transition-colors ${
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

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <span className="hidden rounded border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-mute md:inline">
            Razorpay test mode
          </span>

          {user && (
            <>
              <span
                className="hidden max-w-[180px] truncate text-[13px] text-ink-mute sm:inline"
                title={user.email ?? undefined}
              >
                {user.name ?? user.email}
              </span>

              {user.image && (
                // A Google avatar on a remote host. next/image would need that host
                // allowlisted in the config for a 26px decoration, which is not a
                // trade worth making.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.image}
                  alt=""
                  width={26}
                  height={26}
                  className="h-[26px] w-[26px] shrink-0 rounded-full border border-line"
                />
              )}

              <form action={signOutAction}>
                <button
                  type="submit"
                  className="whitespace-nowrap rounded-md border border-line px-2.5 py-1.5 text-[13px] text-ink-mute transition-colors hover:border-line-strong hover:text-ink"
                >
                  Sign out
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

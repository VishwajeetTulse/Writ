"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonClass } from "@/components/ui";

/**
 * The masthead.
 *
 * The active tab is marked with a rule sitting on the header's own bottom border, not
 * with a filled pill. A pill in a neutral tint is nearly invisible against a neutral
 * page; a 2px rule in ink is unmistakable at a glance and costs no colour.
 *
 * The wordmark is set in the serif — the same voice the product uses for anything a
 * person wrote. Writ is a word before it is a piece of software.
 */

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
    <header className="sticky top-0 z-30 border-b border-line bg-surface/92 backdrop-blur-[2px]">
      <div className="mx-auto flex h-[52px] max-w-[1400px] items-stretch gap-6 px-5 sm:px-8">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 self-center"
          aria-label="Writ, home"
        >
          <span className="human text-title leading-none tracking-[-0.01em]">Writ</span>
          <span
            aria-hidden
            className="hidden h-3.5 w-px bg-line-strong sm:block"
          />
          <span className="eyebrow hidden sm:block">spending authority</span>
        </Link>

        <nav className="scroller -mb-px flex min-w-0 items-stretch gap-0.5">
          {links.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/" || pathname.startsWith("/mandates")
                : pathname.startsWith(link.href);

            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center whitespace-nowrap border-b-2 px-3 text-ui transition-colors ${
                  active
                    ? "border-ink font-medium text-ink"
                    : "border-transparent text-ink-mute hover:text-ink"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-3 self-center">
          <span
            title="No live keys are configured. Nothing here can move real money."
            className="hidden rounded-xs border border-line px-1.5 py-0.5 font-mono text-nano uppercase tracking-[0.07em] text-ink-soft lg:inline"
          >
            test mode
          </span>

          {user && (
            <>
              {user.image && (
                // A Google avatar on a remote host. next/image would need that host
                // allowlisted in the config for a 24px decoration, which is not a
                // trade worth making.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.image}
                  alt=""
                  width={24}
                  height={24}
                  className="h-6 w-6 shrink-0 rounded-full border border-line"
                />
              )}

              <span
                className="hidden max-w-[150px] truncate text-ui text-ink-mute md:inline"
                title={user.email ?? undefined}
              >
                {user.name ?? user.email}
              </span>

              <form action={signOutAction}>
                <button type="submit" className={buttonClass("ghost", "sm")}>
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

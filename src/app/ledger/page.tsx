import Link from "next/link";
import { queryLedger, type EventType } from "@/lib/ledger";
import { prisma } from "@/lib/db";
import { formatPaise } from "@/lib/money";
import { parsePayload, timestamp, violationsFrom } from "@/lib/format";
import { LedgerRow, type LedgerRowData } from "@/components/ledger-row";
import { VerifyChain } from "@/components/verify-chain";
import { buttonClass, Empty, Page, Scroller } from "@/components/ui";
import { requireUser } from "@/lib/session";
import type { Verdict } from "@/lib/policy";

export const dynamic = "force-dynamic";

const FILTERS: Array<{ label: string; params: Record<string, string> }> = [
  { label: "Everything", params: {} },
  { label: "Decisions", params: { type: "POLICY_DECISION" } },
  { label: "Refusals", params: { verdict: "BLOCK" } },
  { label: "Money moved", params: { type: "ORDER_CREATED" } },
];

const COLUMNS = [
  { label: "Seq", align: "left" },
  { label: "Time", align: "left" },
  { label: "Actor", align: "left" },
  { label: "Event", align: "left" },
  { label: "Verdict", align: "left" },
  { label: "Detail", align: "left" },
  { label: "Amount", align: "right" },
  { label: "Took", align: "right" },
  { label: "", align: "right" },
  { label: "Hash", align: "left" },
] as const;

/**
 * The audit trail.
 *
 * A table of rows is not evidence, because anyone can write rows. What makes it
 * evidence is the chain: every row commits to the hash of the row before it, so the
 * trail only verifies if nothing has been edited, reordered or removed since it was
 * written. Hence the chain column, which is otherwise the least interesting thing on
 * the page, and the Verify button, which recomputes all of it live rather than showing
 * a number that was true once.
 *
 * The table sits on the page rather than inside a panel, and scrolls sideways inside
 * its own container. Ten columns of mono at eleven pixels is the densest thing in the
 * product, and it should look like the instrument it is.
 */
export default async function LedgerPage({ searchParams }: PageProps<"/ledger">) {
  const user = await requireUser();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const mandateId = one(sp.mandate);
  const verdict = one(sp.verdict) as Verdict | undefined;
  const type = one(sp.type) as EventType | undefined;

  const [events, total] = await Promise.all([
    queryLedger({ userId: user.id, mandateId, verdict, type, limit: 200 }),
    prisma.auditEvent.count({ where: { mandate: { userId: user.id } } }),
  ]);

  const activeKey = `${verdict ?? ""}|${type ?? ""}`;
  const filtered = Boolean(mandateId || verdict || type);

  // Shaped on the server so the client component receives plain data and no bigints.
  const rows: LedgerRowData[] = events.map((e) => {
    const payload = parsePayload(e.payload);
    const violations = violationsFrom(payload);
    const productName =
      typeof payload.productName === "string" ? payload.productName : null;
    const note = typeof payload.note === "string" ? payload.note : null;

    return {
      seq: e.seq,
      time: timestamp(e.createdAt),
      actor: e.actor,
      type: e.type,
      verdict: e.verdict,
      reasonCode: e.reasonCode,
      amount: e.amountPaise !== null ? formatPaise(e.amountPaise) : null,
      latency: e.latencyUs !== null ? `${(e.latencyUs / 1000).toFixed(2)}ms` : null,
      hash: e.hash,
      detail: productName ?? note,
      extraViolations: Math.max(violations.length - 1, 0),
    };
  });

  return (
    <Page
      wide
      kicker="Append-only · hash-chained"
      title="Ledger"
      lede="Every decision made about your money, allowed and stopped alike."
      actions={<VerifyChain recordCount={total} />}
    >
      <div className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-line pb-4">
        {FILTERS.map((f) => {
          const params = new URLSearchParams(f.params);
          if (mandateId) params.set("mandate", mandateId);
          const key = `${f.params.verdict ?? ""}|${f.params.type ?? ""}`;
          const active = key === activeKey;

          return (
            <Link
              key={f.label}
              href={`/ledger${params.toString() ? `?${params}` : ""}`}
              aria-current={active ? "true" : undefined}
              className={`rounded-xs border px-2.5 py-1 text-small transition-colors ${
                active
                  ? "border-ink bg-ink font-medium text-surface"
                  : "border-line bg-surface text-ink-mute hover:border-line-strong hover:text-ink"
              }`}
            >
              {f.label}
            </Link>
          );
        })}

        {mandateId && (
          <Link
            href={`/ledger${verdict || type ? `?${new URLSearchParams({ ...(verdict ? { verdict } : {}), ...(type ? { type } : {}) })}` : ""}`}
            className="inline-flex items-center gap-1.5 rounded-xs border border-line bg-sunk px-2.5 py-1 font-mono text-micro text-ink-mute transition-colors hover:border-line-strong hover:text-ink"
          >
            {mandateId}
            <span aria-hidden>×</span>
            <span className="sr-only">Clear the mandate filter</span>
          </Link>
        )}

        <span className="ml-auto font-mono text-micro tnum text-ink-soft">
          {events.length} of {total} records
        </span>
      </div>

      {events.length === 0 ? (
        <Empty
          title={filtered ? "Nothing matches this filter." : "The ledger is empty."}
          action={
            filtered ? (
              <Link href="/ledger" className={buttonClass("secondary", "md")}>
                Clear filters
              </Link>
            ) : (
              <Link href="/run" className={buttonClass("primary", "md")}>
                Run an agent
              </Link>
            )
          }
        />
      ) : (
        <Scroller>
          <table className="w-full min-w-[900px] border-collapse text-left">
            <thead>
              <tr className="border-y border-line bg-sunk">
                {COLUMNS.map((c, i) => (
                  <th
                    key={c.label || `col${i}`}
                    scope="col"
                    className={`eyebrow whitespace-nowrap px-3 py-2 font-normal first:pl-4 last:pr-4 ${
                      c.align === "right" ? "text-right" : "text-left"
                    }`}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <LedgerRow key={row.seq} row={row} />
              ))}
            </tbody>
          </table>
        </Scroller>
      )}
    </Page>
  );
}

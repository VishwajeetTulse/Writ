import Link from "next/link";
import { listMandates } from "@/lib/mandate-service";
import { RunConsole } from "@/components/run-console";
import { Empty, Page } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * The run console.
 *
 * This is the demo screen. A buyer shops against a mandate, the gateway decides every
 * attempt, and the runway moves as it happens — including the attempt that runs past
 * the wall and is stopped.
 */
export default async function RunPage() {
  const mandates = await listMandates();

  return (
    <Page
      wide
      title="Agent run"
      lede="A buyer shops against a mandate. Everything it proposes goes through the gateway, which prices the item from the catalog, evaluates the signed terms, and only then reaches Razorpay. Refusals are recorded exactly like purchases."
    >
      {mandates.length === 0 ? (
        <Empty>
          No mandates to run against.{" "}
          <Link href="/mandates/new" className="text-ink underline underline-offset-2">
            Issue one first
          </Link>
          .
        </Empty>
      ) : (
        <RunConsole
          mandates={mandates.map((m) => ({
            id: m.id,
            intentText: m.intentText,
            status: m.status,
            totalCapPaise: Number(m.totalCapPaise),
            spentPaise: Number(m.spentPaise),
          }))}
        />
      )}
    </Page>
  );
}

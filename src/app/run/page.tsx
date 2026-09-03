import Link from "next/link";
import { listMandates } from "@/lib/mandate-service";
import { requireUser } from "@/lib/session";
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
  const user = await requireUser();
  const mandates = await listMandates(user.id);

  return (
    <Page
      wide
      title="Activity"
      lede="Watch an agent shop against a mandate. Every purchase it proposes is judged before any money is committed."
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

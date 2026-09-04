import Link from "next/link";
import { listMandates } from "@/lib/mandate-service";
import { requireUser } from "@/lib/session";
import { RunConsole } from "@/components/run-console";
import { claudeAvailable } from "@/lib/agent/claude";
import { geminiAvailable, geminiModel } from "@/lib/agent/gemini";
import { buttonClass, Empty, Page } from "@/components/ui";

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
      kicker="Live"
      title="Activity"
      lede="Watch an agent shop against a mandate."
    >
      {mandates.length === 0 ? (
        <Empty
          title="There is nothing for an agent to run against."
          action={
            <Link href="/mandates/new" className={buttonClass("primary", "md")}>
              Write a mandate
            </Link>
          }
        >
          An agent needs a mandate before it can propose a single purchase. Write one and
          come back here to watch it work.
        </Empty>
      ) : (
        <RunConsole
          claudeReady={claudeAvailable()}
          geminiReady={geminiAvailable()}
          geminiModel={geminiModel()}
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

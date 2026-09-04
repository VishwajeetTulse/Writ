import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { isTestMode } from "@/lib/razorpay/client";
import { formatPaise } from "@/lib/money";
import { timestamp } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { SettleCheckout } from "@/components/settle-checkout";
import { Field, linkClass, Page, Section, Stack } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Settle one order, by hand, on purpose.
 *
 * The gateway's job finishes when it authorises a collection. Completing that collection
 * needs a payment instrument, and provisioning one is the layer this prototype does not
 * build — so this screen stands in for it, exactly once, so that the settlement half of
 * the integration can be shown with Razorpay's own money movement instead of a webhook
 * this repository wrote itself.
 *
 * It is deliberately not reachable from the run console. An agent that has to wait for a
 * human at a checkout is the slow approval Writ exists to remove, and putting this
 * button anywhere near the agent path would quietly undo the argument.
 */
export default async function SettlePage({ params }: PageProps<"/settle/[id]">) {
  const user = await requireUser();
  const { id } = await params;

  const purchase = await prisma.purchase.findFirst({
    // Scoped through the mandate: settling someone else's order is not a thing.
    where: { id, mandate: { userId: user.id } },
    include: { mandate: { select: { id: true, intentText: true } } },
  });

  if (!purchase || !purchase.razorpayOrderId) notFound();

  const keyId = process.env.RAZORPAY_KEY_ID ?? "";
  const settled = purchase.status === "PAID";

  return (
    <Page
      kicker="Operator action"
      title="Settle this order"
      lede="The gateway authorised this collection. Completing it needs a payment instrument, which this prototype does not provision — so here it is done by hand, once, against Razorpay test mode."
    >
      <Stack>
        <Section title="The order">
          <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
            <Field label="Amount">{formatPaise(purchase.amountPaise)}</Field>
            <Field label="Item">{purchase.sku}</Field>
            <Field label="Razorpay order">{purchase.razorpayOrderId}</Field>
            <Field label="Created">{timestamp(purchase.createdAt)}</Field>
          </div>

          <p className="human mt-6 max-w-[64ch] text-lede leading-[1.55] text-ink-mute">
            Authorised under{" "}
            <Link href={`/mandates/${purchase.mandateId}`} className={linkClass}>
              {purchase.mandate.intentText}
            </Link>
            .
          </p>
        </Section>

        <Section title="Pay it">
          {!isTestMode() ? (
            <p className="rounded-md border border-deny/25 bg-deny-wash px-4 py-3 text-ui text-deny">
              This screen only runs against Razorpay test keys.
            </p>
          ) : settled ? (
            <p className="rounded-md border border-permit/25 bg-permit-wash px-4 py-3 text-ui text-permit">
              Already settled. Nothing to do.
            </p>
          ) : (
            <>
              <p className="human mb-5 max-w-[64ch] text-lede leading-[1.55] text-ink-mute">
                Razorpay&rsquo;s own checkout opens against this order id. Pay it with any
                test card and the capture appears in the Razorpay dashboard as a real
                test-mode transaction, because it is one.
              </p>

              <SettleCheckout
                keyId={keyId}
                orderId={purchase.razorpayOrderId}
                amountPaise={Number(purchase.amountPaise)}
                description={purchase.sku}
              />

              <div className="mt-7 border-t border-hairline pt-5">
                <div className="eyebrow mb-2.5">After paying</div>
                <p className="max-w-[64ch] text-ui leading-relaxed text-ink-mute">
                  Run <span className="font-mono text-micro">npm run reconcile</span>. The
                  ledger settles this purchase by asking Razorpay what happened, rather
                  than by trusting the browser that just told it. On a localhost demo
                  there is no public URL for Razorpay to send a webhook to, so pulling is
                  the only honest route — and it is the same code path that recovers from
                  a webhook being dropped in production.
                </p>
              </div>
            </>
          )}
        </Section>
      </Stack>
    </Page>
  );
}

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
      lede="Pay an order the gateway already authorised."
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
              <SettleCheckout
                keyId={keyId}
                orderId={purchase.razorpayOrderId}
                amountPaise={Number(purchase.amountPaise)}
                description={purchase.sku}
              />

              <p className="mt-6 text-ui text-ink-soft">
                Then run <span className="font-mono text-micro">npm run reconcile</span>.
              </p>
            </>
          )}
        </Section>
      </Stack>
    </Page>
  );
}

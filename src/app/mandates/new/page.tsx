import { listMerchants, searchCatalog } from "@/lib/catalog";
import { MandateForm } from "@/components/mandate-form";
import { Page } from "@/components/ui";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Issue a mandate.
 *
 * The catalog is loaded here on the server and handed to the form so the preview panel
 * can judge real products. Prices cross as numbers rather than bigints because bigint
 * is not serializable across the server/client boundary; the form converts them back
 * before the policy engine sees them, so every comparison is still integer paise.
 */
export default async function NewMandatePage() {
  await requireUser();

  const [merchants, products] = await Promise.all([
    listMerchants(),
    searchCatalog({ limit: 200 }),
  ]);

  return (
    <Page
      wide
      kicker="Grant spending authority"
      title="New mandate"
      lede="Set the limits. The panel beside them shows exactly what they would permit and refuse, against the real catalog, before you sign anything."
    >
      <MandateForm
        merchants={merchants.map((m) => ({
          id: m.id,
          name: m.name,
          vpa: m.vpa,
          category: m.category,
        }))}
        products={products.map((p) => ({
          sku: p.sku,
          name: p.name,
          category: p.category,
          pricePaise: Number(p.pricePaise),
          merchantId: p.merchantId,
          merchantName: p.merchantName,
        }))}
      />
    </Page>
  );
}

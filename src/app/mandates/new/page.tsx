import { listMerchants, searchCatalog } from "@/lib/catalog";
import { MandateForm } from "@/components/mandate-form";
import { Page } from "@/components/ui";

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
  const [merchants, products] = await Promise.all([
    listMerchants(),
    searchCatalog({ limit: 200 }),
  ]);

  return (
    <Page
      wide
      title="New mandate"
      lede="Set the bounds, then read what they mean before you sign. The panel on the right runs the real policy engine over the live catalog on every change, so you can see exactly which products this mandate permits and which it refuses."
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

import Link from "next/link";
import { buttonClass } from "@/components/ui";

/**
 * Nothing here.
 *
 * The wording matters more than it looks. `getMandateDetail` deliberately returns null
 * for a mandate belonging to somebody else, so this page is what a person sees when
 * they ask for an id that is not theirs — and it must not hint that the id exists.
 * "Not found" covers both cases and confirms nothing.
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-[560px] px-5 py-24 sm:px-8">
      <div className="eyebrow mb-4">Not found</div>

      <h1 className="human text-display font-normal leading-[1.15] tracking-[-0.018em]">
        There is nothing at this address.
      </h1>

      <p className="human mt-4 max-w-[48ch] text-lede leading-[1.6] text-ink-mute">
        Either the page does not exist, or it belongs to a different account. Mandates
        are only ever visible to whoever signed them.
      </p>

      <div className="mt-8 flex flex-wrap gap-2">
        <Link href="/" className={buttonClass("primary", "md")}>
          Back to mandates
        </Link>
        <Link href="/ledger" className={buttonClass("secondary", "md")}>
          Open the ledger
        </Link>
      </div>
    </div>
  );
}

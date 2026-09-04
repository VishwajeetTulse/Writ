"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button, buttonClass } from "@/components/ui";

/**
 * Something failed while rendering a screen.
 *
 * The message says what it means for the reader, not what threw. A stack trace or a
 * Prisma error string tells someone looking at their own spending nothing they can act
 * on, and in a product about money it reads as a system that has lost track of itself.
 *
 * The digest is the exception: it is an opaque id Next generates for the underlying
 * error, and it is the one string worth showing, because it is what makes a support
 * conversation possible. The real error is on the server, where it belongs.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-[560px] px-5 py-24 sm:px-8">
      <div className="eyebrow mb-4">Something went wrong</div>

      <h1 className="human text-display font-normal leading-[1.15] tracking-[-0.018em]">
        This screen could not be loaded.
      </h1>

      <p className="human mt-4 max-w-[48ch] text-lede leading-[1.6] text-ink-mute">
        Nothing has been changed and no money has moved. Your mandates and the ledger are
        exactly as they were. Try again, and if it keeps happening the ledger is still
        readable on its own.
      </p>

      <div className="mt-8 flex flex-wrap gap-2">
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <Link href="/" className={buttonClass("secondary", "md")}>
          Back to mandates
        </Link>
      </div>

      {error.digest && (
        <p className="mt-8 border-t border-line pt-4 font-mono text-nano text-ink-soft">
          reference {error.digest}
        </p>
      )}
    </div>
  );
}

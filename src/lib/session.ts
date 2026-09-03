import { redirect } from "next/navigation";
import { auth } from "./auth";

/**
 * Who is asking.
 *
 * Writ has three kinds of caller and each authenticates differently. Keeping them
 * apart is the whole design, because collapsing them would either lock the agent out
 * of the gateway or let a browser session move money.
 *
 *   **A person, in the console.** Proves identity with a Google sign-in and a session
 *   cookie. Uses the helpers below. Sees only their own mandates.
 *
 *   **An agent, at the gateway.** Has no session and never will. Its authority is the
 *   signed mandate it presents, evaluated by the policy engine. `/api/gateway/purchase`
 *   is deliberately outside everything in this file.
 *
 *   **Razorpay, at the webhook.** Proves itself with an HMAC over the raw request body.
 *   Also outside this file.
 *
 * Anything public stays public on purpose: the catalog and the discovery descriptor are
 * meant to be read cold by an AI buyer with no account at all. Open discovery, gated
 * execution.
 */

export interface SignedInUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

/** The signed-in user, or null. Use when a page renders either way. */
export async function currentUser(): Promise<SignedInUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    name: session.user.name ?? null,
    email: session.user.email ?? null,
    image: session.user.image ?? null,
  };
}

/**
 * The signed-in user, or a redirect to sign-in. For pages.
 *
 * Called at the top of every protected server component rather than matched by a
 * pattern in one central file. It is more typing and it is worth it: a route that
 * forgets to call this is visibly missing a line, whereas a route that falls outside a
 * matcher glob looks exactly like one that is covered.
 */
export async function requireUser(): Promise<SignedInUser> {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  return user;
}

/** The signed-in user, or a 401 response. For console API routes. */
export async function requireApiUser(): Promise<
  { user: SignedInUser; response?: never } | { user?: never; response: Response }
> {
  const user = await currentUser();
  if (!user) {
    return {
      response: Response.json(
        { error: "Sign in to use this endpoint." },
        { status: 401 },
      ),
    };
  }
  return { user };
}

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./db";
import { createSampleMandates } from "./sample-data";

/**
 * Sign-in.
 *
 * Google only, and no passwords anywhere. This application never sees, stores or
 * transmits a credential, which removes an entire class of thing that could go wrong
 * in a product whose subject is spending authority.
 *
 * Two deliberate choices worth knowing about.
 *
 * **Database sessions, not JWTs.** A session that lives in a signed cookie cannot be
 * revoked before it expires — you can sign someone out of a browser, but the token
 * keeps working until it lapses. Here the session is a row, so signing out ends it
 * immediately. That matches how the rest of the system already behaves: mandate status
 * is re-read on every purchase rather than cached, for exactly the same reason.
 *
 * **Checked in server components, not in `proxy.ts`.** Next 16 renamed middleware to
 * proxy and its own documentation says not to rely on shared modules there, because it
 * may run at the edge. The Prisma adapter is a shared module and needs Node. Doing the
 * check where the data is read keeps Prisma out of the edge runtime, and makes each
 * protected surface say out loud that it is protected instead of trusting a matcher
 * pattern in a file nobody looks at.
 */

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),

  providers: [Google],

  session: { strategy: "database" },

  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },

  callbacks: {
    /**
     * Put the user id on the session.
     *
     * Everything downstream filters on it — mandates, purchases, ledger events — so
     * this one line is what the whole authorisation model rests on.
     */
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },

  events: {
    /**
     * A brand-new account has nothing to look at, and an empty console cannot show
     * anyone what this is for. So a new user gets their own sample mandates: real,
     * signed, theirs, and immediately usable.
     *
     * Failure here must not block sign-in. Getting in without sample data is a mild
     * disappointment; being unable to sign in at all because a demo fixture failed
     * would be absurd.
     */
    async createUser({ user }) {
      if (!user.id) return;
      try {
        await createSampleMandates(user.id);
      } catch (err) {
        console.error("Could not create sample mandates for a new user:", err);
      }
    },
  },
});

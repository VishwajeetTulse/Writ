import type { DefaultSession } from "next-auth";

/**
 * The user id on the session.
 *
 * Auth.js does not include it by default. Everything in this application filters on
 * it, so it is worth having the type system insist it is there.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

import { handlers } from "@/lib/auth";

/**
 * Auth.js request handlers: the Google redirect, the callback, sign-out, and the
 * session endpoint. Nothing here is ours, and nothing here should be.
 */
export const { GET, POST } = handlers;

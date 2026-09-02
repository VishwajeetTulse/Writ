/**
 * Vitest setup. Runs before any test module is imported, which matters because some
 * suites sign a mandate at collection time — the key has to exist before that.
 *
 * A fixed, obviously-fake key keeps signature tests deterministic and keeps the real
 * .env key out of the test run.
 */
process.env.MANDATE_SIGNING_KEY =
  "test-key-do-not-use-in-production-0123456789";

/**
 * The account the test harnesses spend under.
 *
 * A fixed, obviously-not-a-person id, so harness mandates never appear in a real
 * account's console and never inflate anybody's spending figures. There is no foreign
 * key on `Mandate.userId`, so this needs no matching row in the users table — which is
 * the point: a harness is not a user.
 */
export const HARNESS_USER_ID = "harness";

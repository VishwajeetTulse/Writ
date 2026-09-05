/**
 * The viewer's theme preference.
 *
 * Held in a cookie rather than localStorage, because the server has to be able to read
 * it. With localStorage only the browser knows the choice, so the server always commits
 * to HTML with no `data-theme` on it and a script has to add the attribute afterwards —
 * which is a hydration mismatch by construction, and papering over it with
 * `suppressHydrationWarning` leaves React and the DOM genuinely disagreeing.
 *
 * A cookie rides along with the request, so the server renders the attribute itself and
 * there is nothing to correct: no mismatch and no flash. It costs static prerendering of
 * everything under the root layout, but that was already spent — the layout reads the
 * signed-in user on every request.
 */

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_COOKIE = "writ-theme";

/** A year. Nobody wants to be asked their theme twice. */
export const THEME_MAX_AGE = 60 * 60 * 24 * 365;

/** Anything unrecognised, including a missing cookie, means follow the machine. */
export function parseTheme(value: string | undefined | null): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

/**
 * What to put on `<html>`. `system` is the absence of the attribute, which is what lets
 * the `prefers-color-scheme` rules in globals.css through.
 */
export function themeAttribute(choice: ThemeChoice): "light" | "dark" | undefined {
  return choice === "system" ? undefined : choice;
}

/** Written by the toggle, read by the layout on the next request. */
export function themeCookie(choice: ThemeChoice): string {
  const base = `${THEME_COOKIE}=`;
  return choice === "system"
    ? `${base}; path=/; max-age=0; samesite=lax`
    : `${base}${choice}; path=/; max-age=${THEME_MAX_AGE}; samesite=lax`;
}

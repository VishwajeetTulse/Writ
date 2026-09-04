"use client";

import { useSyncExternalStore } from "react";

/**
 * Light, dark, or whatever the system says.
 *
 * Three states rather than two, because "follow my machine" is a real preference and a
 * two-way switch cannot express it. The default is system, which means most people never
 * touch this.
 *
 * The chosen mode is read from the `data-theme` attribute rather than kept in React
 * state. That attribute is the single source of truth: an inline script in the layout
 * sets it before the first paint, so there is no flash of the wrong theme, and reading it
 * back means the button can never disagree with the page it sits on.
 */

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_KEY = "writ-theme";

/** Fired on the window so every mounted toggle re-reads at once. */
const CHANGED = "writ-theme-change";

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  // Another tab changing the preference should move this one too.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot(): ThemeChoice {
  const set = document.documentElement.dataset.theme;
  return set === "light" || set === "dark" ? set : "system";
}

/** The server cannot know the preference, so it renders the default and corrects after. */
function getServerSnapshot(): ThemeChoice {
  return "system";
}

const NEXT: Record<ThemeChoice, ThemeChoice> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const LABEL: Record<ThemeChoice, string> = {
  system: "auto",
  light: "light",
  dark: "dark",
};

export function ThemeToggle() {
  const choice = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function cycle() {
    const next = NEXT[choice];
    const root = document.documentElement;

    if (next === "system") {
      delete root.dataset.theme;
    } else {
      root.dataset.theme = next;
    }

    // A private window or blocked site data must not break the toggle, only its memory.
    try {
      if (next === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      // Preference is not persisted. The page still changed, which is what was asked.
    }

    window.dispatchEvent(new Event(CHANGED));
  }

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Theme: ${LABEL[choice]}. Switch to ${LABEL[NEXT[choice]]}.`}
      title={`Theme: ${LABEL[choice]}`}
      className="hidden h-7 w-[52px] shrink-0 items-center justify-center rounded-xs border border-line font-mono text-nano uppercase tracking-[0.07em] text-ink-soft transition-colors hover:border-line-strong hover:text-ink sm:inline-flex"
    >
      {LABEL[choice]}
    </button>
  );
}

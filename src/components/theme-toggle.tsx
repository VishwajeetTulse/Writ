"use client";

import { useSyncExternalStore } from "react";
import {
  parseTheme,
  themeCookie,
  type ThemeChoice,
} from "@/lib/theme";

/**
 * Light, dark, or whatever the system says.
 *
 * Three states rather than two, because "follow my machine" is a real preference and a
 * two-way switch cannot express it. The default is system, which means most people never
 * touch this.
 *
 * The `data-theme` attribute on `<html>` is the single source of truth on the client, and
 * the server puts it there from the cookie before the page is sent. Reading it back rather
 * than keeping a copy in React state means the button can never disagree with the page it
 * sits on, and the value React hydrates with is the value already in the DOM.
 */

/** Fired on this window so every mounted toggle re-reads at once. */
const CHANGED = "writ-theme-change";

/** Carries a change to this browser's other tabs, which share the cookie. */
const CHANNEL = "writ-theme";

let bus: BroadcastChannel | null = null;

function channel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  bus ??= new BroadcastChannel(CHANNEL);
  return bus;
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
}

function getSnapshot(): ThemeChoice {
  return parseTheme(document.documentElement.dataset.theme);
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);

  // A channel message only ever arrives from another tab, so this one has to move the
  // attribute itself before re-reading it.
  const fromOtherTab = (event: MessageEvent) => {
    apply(parseTheme(event.data as string));
    onChange();
  };
  channel()?.addEventListener("message", fromOtherTab);

  return () => {
    window.removeEventListener(CHANGED, onChange);
    channel()?.removeEventListener("message", fromOtherTab);
  };
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

export function ThemeToggle({ initial }: { initial: ThemeChoice }) {
  // `initial` is what the server rendered onto <html> from the same cookie, so the
  // hydrating value and the value in the DOM are the same and there is nothing to patch.
  const choice = useSyncExternalStore(subscribe, getSnapshot, () => initial);

  function cycle() {
    const next = NEXT[choice];

    apply(next);
    // A private window or blocked site data must not break the toggle, only its memory.
    try {
      document.cookie = themeCookie(next);
    } catch {
      // Preference is not persisted. The page still changed, which is what was asked.
    }

    window.dispatchEvent(new Event(CHANGED));
    channel()?.postMessage(next);
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

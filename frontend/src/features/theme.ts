import { useSyncExternalStore } from "react";
import { syncPlotTheme } from "../components/plotTheme";

/** Two themes: the dark workspace and a black-on-white one for printed screenshots. */
export type Theme = "dark" | "print";

const STORAGE_KEY = "cl-theme";
const EVENT = "cl-theme-change";

export function storedTheme(): Theme {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("theme");
    if (fromUrl === "print" || fromUrl === "dark") return fromUrl;
    return window.localStorage.getItem(STORAGE_KEY) === "print" ? "print" : "dark";
  } catch {
    return "dark";
  }
}

function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  syncPlotTheme(theme);
}

export function applyStoredTheme(): void {
  apply(storedTheme());
}

export function setTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage may be blocked; the theme still applies for this page.
  }
  apply(theme);
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

function snapshot(): Theme {
  return document.documentElement.dataset.theme === "print" ? "print" : "dark";
}

/** Re-renders the caller when the theme changes (charts read their colours at render time). */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

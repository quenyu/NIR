import { useEffect, useState } from "react";

/*
 * Animations are on by default, whatever the operating system says: the user
 * turns them off in the app ("⋯" → Анимации). Many Windows installations have
 * "Show animations" disabled, which would otherwise silence the whole interface.
 * The choice is kept per browser and mirrored as `motion-off` on <html> for CSS.
 */
const STORAGE_KEY = "cl-motion";
const EVENT = "cl-motion-change";

function readSetting(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

let enabled = typeof window === "undefined" ? true : readSetting();

function applyClass() {
  if (typeof document !== "undefined") document.documentElement.classList.toggle("motion-off", !enabled);
}
applyClass();

export function motionEnabled(): boolean {
  return enabled;
}

export function setMotionEnabled(value: boolean): void {
  enabled = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "on" : "off");
  } catch {
    // The setting then lasts for this page only.
  }
  applyClass();
  window.dispatchEvent(new Event(EVENT));
}

/** Kept for the motion helpers: true when animations are switched off in the app. */
export function prefersReducedMotion(): boolean {
  return !enabled;
}

export function useMotionEnabled(): boolean {
  const [value, setValue] = useState(enabled);
  useEffect(() => {
    const update = () => setValue(enabled);
    window.addEventListener(EVENT, update);
    return () => window.removeEventListener(EVENT, update);
  }, []);
  return value;
}

export function useReducedMotion(): boolean {
  return !useMotionEnabled();
}

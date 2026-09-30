// Light or dark. "system" follows the operating system and keeps following it
// if it changes. The choice is a per-viewer convenience, so it lives in
// localStorage, which may be unavailable; the app works the same without it.

import { create } from "zustand";

export type ThemeChoice = "system" | "light" | "dark";
const KEY = "vitrine-theme";
const ORDER: ThemeChoice[] = ["system", "light", "dark"];

function stored(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "system" || v === "light" || v === "dark") return v;
  } catch {
    // storage blocked: fall back to the system setting
  }
  return "system";
}

export const useTheme = create<{ choice: ThemeChoice }>(() => ({ choice: stored() }));

const media = window.matchMedia("(prefers-color-scheme: dark)");

function apply() {
  const { choice } = useTheme.getState();
  const dark = choice === "dark" || (choice === "system" && media.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

media.addEventListener("change", apply);
useTheme.subscribe(apply);
apply();

export function cycleTheme() {
  const next = ORDER[(ORDER.indexOf(useTheme.getState().choice) + 1) % ORDER.length];
  useTheme.setState({ choice: next });
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // not remembered, still applied
  }
}

// The screens on the board and the connection state of each preview. Written
// by the board loader and by each preview's connection.

import { create } from "zustand";
import type { Screen } from "../core/api";

export interface PreviewState {
  status: "connecting" | "ready" | "error";
  /** `soft`: the page is still worth seeing (it loaded, then something in
   *  the viewer failed), so the error sits over it instead of replacing it. */
  error: { title: string; message: string; detail?: string; soft: boolean } | null;
  /** Bumped by Retry: a new attempt is a new iframe and a new connection. */
  attempt: number;
  pageErrors: string[];
  /** The page the preview is showing now; changes when a link is followed. */
  url: string | null;
  /** Dev menu only: load a page that does not exist, or ignore its script. */
  sabotage: "missing" | "mute" | null;
}

export interface BoardState {
  status: "loading" | "ready" | "error";
  error: string | null;
  /** The board broke while drawing, as opposed to the screens not arriving. */
  crashed: boolean;
  /** Bumped by every load. The board's error boundary is keyed on it, so a
   *  reload always starts from a fresh boundary. */
  attempt: number;
  screens: Screen[];
  previews: Record<string, PreviewState>;
}

export const useBoard = create<BoardState>(() => ({
  status: "loading",
  error: null,
  crashed: false,
  attempt: 0,
  screens: [],
  previews: {},
}));

export const newPreview = (): PreviewState => ({
  status: "connecting",
  error: null,
  attempt: 0,
  pageErrors: [],
  url: null,
  sabotage: null,
});

export function patchPreview(screenId: string, patch: Partial<PreviewState>) {
  useBoard.setState((s) =>
    s.previews[screenId] ? { previews: { ...s.previews, [screenId]: { ...s.previews[screenId], ...patch } } } : s,
  );
}

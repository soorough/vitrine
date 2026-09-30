// What the user is doing: the mode, the active preview, the selection and the
// hover. Written by the commands in core/commands.ts, which run in response
// to user input. A page can only ever take things away from this state (an
// element that stops existing, a document that navigates), never add to it.

import { create } from "zustand";
import type { Mode, Ref } from "../shared/protocol";

export interface Hover extends Ref {
  screenId: string;
  source: "pointer" | "panel";
}

export interface Selection {
  screenId: string;
  /** In the order they were selected; the last one is the most recent. */
  items: Ref[];
}

export interface Session {
  mode: Mode;
  activeId: string | null;
  selection: Selection | null;
  hover: Hover | null;
  /** The whole selection stopped existing. Cleared by the next selection. */
  lost: boolean;
  /** Alt is held: show distances from the selection to what is hovered. */
  measuring: boolean;
}

export const initialSession: Session = { mode: "select", activeId: null, selection: null, hover: null, lost: false, measuring: false };

export const useSession = create<Session>(() => initialSession);

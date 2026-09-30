// Facts about each page, as last reported by its agent. Written only by the
// preview's connection when a message arrives; the host never edits them.

import { create } from "zustand";
import type { Geometry, Id, Live } from "../shared/protocol";

export const useGeometry = create<Record<string, Record<Id, Geometry>>>(() => ({}));
export const useLive = create<Record<string, Record<Id, Live>>>(() => ({}));

export function dropPageFacts(screenId: string) {
  if (screenId in useGeometry.getState()) {
    const { [screenId]: _, ...rest } = useGeometry.getState();
    useGeometry.setState(rest, true);
  }
  if (screenId in useLive.getState()) {
    const { [screenId]: _, ...rest } = useLive.getState();
    useLive.setState(rest, true);
  }
}

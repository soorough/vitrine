// Failure injection for the dev menu. Arming a point makes the next pass
// through it throw; nothing here does anything in a production build.

import { create } from "zustand";

export type ChaosPoint =
  | "preview-draw"
  | "preview-render"
  | "board-render"
  | "preview-click"
  | "preview-message"
  | "preview-timer"
  | "preview-response"
  | "key"
  | "details-response"
  | "inspector-render"
  | "layers-render"
  | "drop-children";

export const DEV = import.meta.env.DEV;

interface ChaosState {
  /** Armed points, optionally for one preview only. */
  armed: Partial<Record<ChaosPoint, string | true>>;
  api: Record<"screens" | "details", { latency: number; fail: number; failNext: boolean }>;
}

export const useChaos = create<ChaosState>(() => ({
  armed: {},
  api: {
    screens: { latency: 0, fail: 0, failNext: false },
    details: { latency: 0, fail: 0, failNext: false },
  },
}));

/** Every call to report(), newest last, so the dev menu can show that a
 *  failure was reported once and only once. */
export interface ReportEntry {
  region: string;
  screenId: string | null;
  elementKey?: string;
  message: string;
}
export const useReports = create<{ entries: ReportEntry[] }>(() => ({ entries: [] }));

export function arm(point: ChaosPoint, screenId?: string) {
  useChaos.setState((s) => ({ armed: { ...s.armed, [point]: screenId ?? true } }));
}

export function disarm(point: ChaosPoint) {
  useChaos.setState((s) => {
    const { [point]: _, ...armed } = s.armed;
    return { armed };
  });
}

export function isArmed(point: ChaosPoint, screenId?: string | null): boolean {
  if (!DEV) return false;
  const target = useChaos.getState().armed[point];
  return target === true || (target !== undefined && target === screenId);
}

/** True once, if the point was armed. */
export function take(point: ChaosPoint, screenId?: string | null): boolean {
  if (!isArmed(point, screenId)) return false;
  disarm(point);
  return true;
}

export function chaos(point: ChaosPoint, screenId?: string | null): void {
  if (take(point, screenId)) throw new Error(`Injected failure (${point})`);
}

export function setApiKnob(route: "screens" | "details", patch: Partial<ChaosState["api"]["screens"]>) {
  useChaos.setState((s) => ({ api: { ...s.api, [route]: { ...s.api[route], ...patch } } }));
}

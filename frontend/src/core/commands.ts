// Commands: the only code that changes what the user is doing (mode, active
// preview, selection, hover). UI event handlers and forwarded events from the
// previews call these; nothing else writes the session store.

import { framePosition, useCamera, zoomBy, zoomToFit, zoomToFrame } from "../state/camera";
import { newPreview, patchPreview, useBoard } from "../state/board";
import { dropPageFacts, useGeometry, useLive } from "../state/page";
import { useLayers } from "../state/layers";
import { initialSession, useSession } from "../state/session";
import type { Id, Mode, Ref } from "../shared/protocol";
import { getScreens } from "./api";
import { chaos } from "./chaos";
import { allConnections, getConnection } from "./connection";
import { ancestorsOf, ensureRoot, layersOf, resetLayers, revealInPanel } from "./layers";
import { Scope } from "./regions";

const REQUEST_TIMEOUT = 10_000;

// ── Board ─────────────────────────────────────────────────────────────────

let boardScope: Scope | null = null;

/** The scope for failures that belong to the board as a whole. */
export const getBoardScope = () => boardScope;

export function loadBoard() {
  boardScope?.close();
  const scope = new Scope({ region: "board", screenId: null }, (error) => {
    useBoard.setState({ status: "error", error: error.message, screens: [], previews: {} });
  });
  boardScope = scope;

  for (const screenId of Object.keys(useBoard.getState().previews)) resetLayers(screenId);
  useBoard.setState((s) => ({ status: "loading", error: null, crashed: false, attempt: s.attempt + 1, screens: [], previews: {} }));
  useSession.setState({ ...initialSession, mode: useSession.getState().mode });
  useGeometry.setState({}, true);
  useLive.setState({}, true);
  useLayers.setState({}, true);

  scope.run(async () => {
    const screens = await getScreens(scope.signal);
    useBoard.setState({
      status: "ready",
      screens,
      previews: Object.fromEntries(screens.map((s) => [s.id, newPreview()])),
    });
  });
}

export function retryPreview(screenId: string, sabotage: "missing" | "mute" | null = null) {
  const preview = useBoard.getState().previews[screenId];
  if (!preview) return;
  resetPage(screenId);
  patchPreview(screenId, { ...newPreview(), attempt: preview.attempt + 1, sabotage });
}

/** Drops everything known about a preview's current document. */
export function resetPage(screenId: string) {
  dropPageFacts(screenId);
  resetLayers(screenId);
  if (pointerScreen === screenId) pointerScreen = null;
  const s = useSession.getState();
  useSession.setState({
    selection: s.selection?.screenId === screenId ? null : s.selection,
    hover: s.hover?.screenId === screenId ? null : s.hover,
  });
}

// ── Mode ──────────────────────────────────────────────────────────────────

export function setMode(mode: Mode) {
  if (useSession.getState().mode === mode) return;
  pointerLeave();
  useSession.setState({ mode, hover: null });
  for (const connection of allConnections()) connection.send({ t: "mode", mode });
  if (mode === "select") {
    // Take the keyboard back from whichever page had it.
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.focus();
  }
}

// ── Selection ─────────────────────────────────────────────────────────────

function activate(screenId: string) {
  if (useSession.getState().activeId !== screenId) useSession.setState({ activeId: screenId });
  ensureRoot(screenId);
}

function select(screenId: string, ref: Ref, additive: boolean) {
  const current = useSession.getState().selection;
  let items = [ref];
  if (additive && current?.screenId === screenId) {
    items = current.items.some((i) => i.id === ref.id)
      ? current.items.filter((i) => i.id !== ref.id)
      : [...current.items, ref];
  }
  useSession.setState(
    items.length ? { selection: { screenId, items }, lost: false, activeId: screenId } : { selection: null },
  );
}

// Selection intent. Every action that decides what the selection should be
// takes a turn. A page's answer to a click is applied only if no later action
// has spoken since; a plain click cancels the clicks still waiting before it,
// so one of those can never come back, override it, or time out and fail the
// preview. Shift+clicks add to each other: their answers are applied in the
// order the clicks were made.
let intent = 0;
const waiting = new Set<AbortController>();

function supersede() {
  intent++;
  for (const request of waiting) request.abort();
  waiting.clear();
}

export function clearSelection() {
  supersede();
  if (useSession.getState().selection) useSession.setState({ selection: null });
}

let clicks: Promise<unknown> = Promise.resolve();

/** A click in a preview, in Select mode. */
export function pickAt(screenId: string, x: number, y: number, shift: boolean) {
  const connection = getConnection(screenId);
  if (!connection) return;
  if (!shift) supersede();
  const turn = intent;
  const request = new AbortController();
  waiting.add(request);

  // Asked at once, so the page answers as fast as it can.
  const answer = connection.scope.run(async () => {
    chaos("preview-click", screenId);
    try {
      return await connection.request("pick", { x, y }, { timeout: REQUEST_TIMEOUT, signal: request.signal });
    } finally {
      waiting.delete(request);
    }
  });

  // Applied in click order, and only if it is still what the user wants.
  clicks = clicks
    .then(async () => {
      const ref = await answer;
      if (ref === undefined || turn !== intent) return;
      connection.scope.run(() => {
        chaos("preview-response", screenId);
        activate(screenId);
        if (!ref) {
          // Page background.
          if (useSession.getState().selection) useSession.setState({ selection: null });
          return;
        }
        select(screenId, ref, shift);
        revealInPanel(screenId, ref);
      });
    })
    .catch(() => undefined); // a failed or cancelled click was already handled by its scope
}

/** A click on a layers row, or an arrow key in the panel. */
export function selectRow(screenId: string, id: Id, additive: boolean) {
  const connection = getConnection(screenId);
  const state = layersOf(screenId);
  const name = state.results?.find((r) => r.id === id)?.name ?? state.nodes[id]?.name;
  if (!connection || name === undefined) return;
  if (!additive) supersede();
  connection.scope.run(() => {
    const ref = { id, name, ancestors: ancestorsOf(screenId, id) };
    select(screenId, ref, additive);
    if (!additive) revealInPanel(screenId, ref);
    // Scroll the page, and only the page, so the element is in view.
    return connection.request("reveal", { id }, { timeout: REQUEST_TIMEOUT }).then(() => undefined);
  });
}

// Keys can arrive faster than the page answers. Steps run one after another,
// each from wherever the one before it landed, and are dropped if the
// selection changed while the page was answering.
let stepping: Promise<void> = Promise.resolve();

/** Enter, Shift+Enter, Tab, Shift+Tab: walk from the most recent selection. */
function step(dir: "parent" | "child" | "next" | "prev") {
  supersede();
  stepping = stepping
    .then(async () => {
      const selection = useSession.getState().selection;
      const connection = selection && getConnection(selection.screenId);
      if (!selection || !connection) return;
      const from = selection.items[selection.items.length - 1];
      await connection.scope.run(async () => {
        const ref = await connection.request("step", { id: from.id, dir }, { timeout: REQUEST_TIMEOUT });
        if (!ref || useSession.getState().selection !== selection) return;
        select(selection.screenId, ref, false);
        revealInPanel(selection.screenId, ref);
        connection.request("reveal", { id: ref.id }, { timeout: REQUEST_TIMEOUT }).catch(connection.scope.fail);
      });
    })
    .catch(() => undefined);
}

/** The agent says these elements no longer exist. */
export function onGone(screenId: string, ids: Id[]) {
  const gone = new Set(ids);
  const s = useSession.getState();
  const patch: Partial<typeof s> = {};
  if (s.hover?.screenId === screenId && gone.has(s.hover.id)) patch.hover = null;
  if (s.selection?.screenId === screenId && s.selection.items.some((i) => gone.has(i.id))) {
    const items = s.selection.items.filter((i) => !gone.has(i.id));
    patch.selection = items.length ? { screenId, items } : null;
    if (!items.length) patch.lost = true;
  }
  if (Object.keys(patch).length) useSession.setState(patch);
}

// ── Hover ─────────────────────────────────────────────────────────────────

let pointerScreen: string | null = null;
let pointerAt: { x: number; y: number } | null = null;
let pointerFrame = 0;

// When the board moves under a pointer that is not moving, the browser still
// sends pointer moves. Those must not bring the hover back mid-gesture, so
// moves are ignored until the camera has been still for a moment.
const SETTLE = 160;
let cameraMovedAt = -Infinity;
useCamera.subscribe(() => {
  cameraMovedAt = performance.now();
  // Panning, zooming, Fit, Shift+1/2, a toast's Show: the board moved, so
  // nothing is under the pointer any more until it moves again.
  pointerLeave();
});

/** The pointer is over a preview, at (x, y) in that page's own pixels. */
export function pointerMove(screenId: string, x: number, y: number) {
  if (useSession.getState().mode !== "select") return;
  if (performance.now() - cameraMovedAt < SETTLE) return;
  if (pointerScreen && pointerScreen !== screenId) pointerLeave();
  pointerScreen = screenId;
  pointerAt = { x, y };
  // At most one message per frame, however fast the mouse reports.
  pointerFrame ||= requestAnimationFrame(() => {
    pointerFrame = 0;
    const connection = pointerScreen && getConnection(pointerScreen);
    if (!connection) return;
    connection.scope.run(() => {
      chaos("preview-timer", connection.screen.id);
      connection.send({ t: "pointer", at: pointerAt });
    });
  });
}

/** The pointer left the preview or the window, or the board started moving. */
export function pointerLeave() {
  if (pointerScreen) getConnection(pointerScreen)?.send({ t: "pointer", at: null });
  pointerScreen = null;
  pointerAt = null;
  if (useSession.getState().hover?.source === "pointer") useSession.setState({ hover: null });
}

/** The agent's answer to where the pointer is. */
export function onPointerHover(screenId: string, ref: Ref | null) {
  // An answer that arrives after the pointer has moved on is dropped, which
  // is what keeps a single hover on the whole board.
  if (pointerScreen !== screenId || useSession.getState().mode !== "select") return;
  useSession.setState({ hover: ref ? { ...ref, screenId, source: "pointer" } : null });
}

export function hoverRow(screenId: string, id: Id | null) {
  const s = useSession.getState();
  if (id === null) {
    if (s.hover?.source === "panel") useSession.setState({ hover: null });
    return;
  }
  if (s.hover?.id === id && s.hover.screenId === screenId) return;
  const name = layersOf(screenId).nodes[id]?.name ?? "";
  useSession.setState({ hover: { id, name, ancestors: ancestorsOf(screenId, id), screenId, source: "panel" } });
}

// ── Keeping each agent's watch list in step ───────────────────────────────

/** Tells each agent which elements to stream geometry and live values for. */
export function syncTracking() {
  const { selection, hover, mode } = useSession.getState();
  for (const connection of allConnections()) {
    const id = connection.screen.id;
    const selected = selection?.screenId === id ? selection.items.map((i) => i.id) : [];
    const hovered = mode === "select" && hover?.screenId === id && hover.source === "panel" ? hover.id : null;
    const next = JSON.stringify([selected, hovered]);
    if (next === connection.tracked || !connection.doc) continue;
    connection.tracked = next;
    connection.send({ t: "track", selected, hover: hovered });
  }
}
useSession.subscribe(syncTracking);

// ── Keyboard ──────────────────────────────────────────────────────────────

export interface Key {
  key: string;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
}

/**
 * One handler for shortcuts, whether the key was pressed in the host or
 * forwarded from a preview that had focus. Returns true if it was a shortcut.
 */
export function handleKey(k: Key, fromScreenId: string | null = null): boolean {
  if (k.ctrl || k.meta || k.alt) return false;
  const { mode, selection, activeId } = useSession.getState();
  const key = k.key.length === 1 ? k.key.toLowerCase() : k.key;

  // Shift+1 fits the whole board, Shift+2 the preview being worked on.
  if (k.shift && (key === "!" || key === "1")) {
    zoomToFit(useBoard.getState().screens.length);
    return true;
  }
  if (k.shift && (key === "@" || key === "2")) {
    focusPreview(selection?.screenId ?? activeId ?? fromScreenId);
    return true;
  }

  const known = key === "v" || key === "i" || key === "Escape" || key === "Enter" || key === "Tab";
  if (!known) return false;

  // A throw while handling a key belongs to the preview it acts on.
  const scope = getConnection(selection?.screenId ?? fromScreenId ?? "")?.scope ?? getBoardScope();
  let handled = true;
  scope?.run(() => {
    chaos("key");
    if (key === "v") setMode("select");
    else if (key === "i") setMode("interact");
    else if (key === "Escape") clearSelection();
    else if (mode !== "select" || !selection) handled = false;
    else if (key === "Enter") step(k.shift ? "parent" : "child");
    else step(k.shift ? "prev" : "next");
  });
  return handled;
}

export function focusPreview(screenId: string | null) {
  const index = useBoard.getState().screens.findIndex((s) => s.id === screenId);
  if (index >= 0) zoomToFrame(index);
}

export function setMeasuring(on: boolean) {
  if (useSession.getState().measuring !== on) useSession.setState({ measuring: on });
}

// ── Zoom from inside a preview ────────────────────────────────────────────

export const wheelFactor = (dy: number) => Math.exp(-Math.max(-60, Math.min(60, dy)) * 0.01);

/** Ctrl/Cmd + wheel happened inside a page, at (x, y) in its own pixels. */
export function zoomFromPreview(screenId: string, x: number, y: number, dy: number) {
  const index = useBoard.getState().screens.findIndex((s) => s.id === screenId);
  if (index < 0) return;
  const camera = useCamera.getState();
  const frame = framePosition(index);
  pointerLeave();
  zoomBy(wheelFactor(dy), camera.x + (frame.x + x) * camera.z, camera.y + (frame.y + y) * camera.z);
}

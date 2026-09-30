// The camera: where the board is and how far it is zoomed. Written only by
// the board's gestures and the toolbar's zoom controls.

import { create } from "zustand";

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

export const FRAME_W = 1280;
export const FRAME_H = 800;
export const GAP_X = 200;
export const GAP_Y = 260;
export const COLUMNS = 6;

export interface Camera {
  x: number;
  y: number;
  z: number;
}

export const useCamera = create<Camera>(() => ({ x: 64, y: 96, z: 0.5 }));

export const framePosition = (index: number) => ({
  x: (index % COLUMNS) * (FRAME_W + GAP_X),
  y: Math.floor(index / COLUMNS) * (FRAME_H + GAP_Y),
});

let flight = 0;

/** Moves the camera over a fifth of a second. Any direct camera change, such
 *  as the user panning, takes over immediately. */
export function flyTo(target: Camera) {
  cancelAnimationFrame(flight);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return useCamera.setState(target);
  const from = useCamera.getState();
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / 220);
    const e = 1 - (1 - t) ** 3;
    useCamera.setState({
      x: from.x + (target.x - from.x) * e,
      y: from.y + (target.y - from.y) * e,
      z: from.z + (target.z - from.z) * e,
    });
    if (t < 1) flight = requestAnimationFrame(step);
  };
  flight = requestAnimationFrame(step);
}

/** The camera that centres a rectangle of the board with room around it. */
function framing(x: number, y: number, w: number, h: number): Camera {
  const pad = 72;
  const fit = Math.min((boardSize.width - 2 * pad) / w, (boardSize.height - 2 * pad) / h);
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit));
  return { z, x: (boardSize.width - w * z) / 2 - x * z, y: (boardSize.height - h * z) / 2 - y * z };
}

/** Whether any part of a preview is inside the visible board. */
export function isFrameVisible(index: number): boolean {
  const { x, y, z } = useCamera.getState();
  const p = framePosition(index);
  const left = x + p.x * z;
  const top = y + p.y * z;
  return left < boardSize.width && left + FRAME_W * z > 0 && top < boardSize.height && top + FRAME_H * z > 0;
}

export function zoomToFrame(index: number) {
  const p = framePosition(index);
  flyTo(framing(p.x, p.y, FRAME_W, FRAME_H));
}

export function zoomToFit(count: number) {
  const columns = Math.min(count, COLUMNS);
  const rows = Math.ceil(count / COLUMNS);
  flyTo(framing(0, 0, columns * (FRAME_W + GAP_X) - GAP_X, rows * (FRAME_H + GAP_Y) - GAP_Y));
}

export function panBy(dx: number, dy: number) {
  cancelAnimationFrame(flight);
  useCamera.setState((c) => ({ x: c.x + dx, y: c.y + dy }));
}

/** Zooms so the board point under (px, py) stays under it. */
export function zoomTo(z: number, px: number, py: number) {
  cancelAnimationFrame(flight);
  useCamera.setState((c) => {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    const k = next / c.z;
    return { z: next, x: px - (px - c.x) * k, y: py - (py - c.y) * k };
  });
}

export function zoomBy(factor: number, px: number, py: number) {
  zoomTo(useCamera.getState().z * factor, px, py);
}

/** The board's size on screen, kept by the board itself. */
export const boardSize = { width: 0, height: 0 };

export function zoomAtCentre(z: number) {
  const c = useCamera.getState();
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  const k = next / c.z;
  const px = boardSize.width / 2;
  const py = boardSize.height / 2;
  flyTo({ z: next, x: px - (px - c.x) * k, y: py - (py - c.y) * k });
}

// The controls that float over the board: the mode switch at the bottom
// centre, zoom and the dev menu at the bottom left.

import { setMode } from "../core/commands";
import { DEV } from "../core/chaos";
import { useBoard } from "../state/board";
import { MAX_ZOOM, MIN_ZOOM, useCamera, zoomAtCentre, zoomToFit } from "../state/camera";
import { useSession } from "../state/session";
import type { Mode } from "../shared/protocol";
import { DevMenu } from "./DevMenu";

const MODES: Array<{ mode: Mode; label: string; shortcut: string; hint: string; icon: string }> = [
  {
    mode: "select",
    label: "Select",
    shortcut: "V",
    hint: "Click elements to select them. The page does not react.",
    icon: "M3.5 2l9.2 6.6-4 .7 2.3 4.3-1.7.9-2.3-4.3-3.5 2.5z",
  },
  {
    mode: "interact",
    label: "Interact",
    shortcut: "I",
    hint: "Use the page as a visitor would.",
    icon: "M6 7.2V3.3a1.2 1.2 0 012.4 0v3.4l3.4.8c.8.2 1.3.9 1.1 1.7l-.6 3.2a2.1 2.1 0 01-2 1.6H7.7a2.1 2.1 0 01-1.7-.9L3.3 9.6a1.1 1.1 0 011.6-1.4z",
  },
];

// Buttons here never take focus, so the keyboard keeps working on the board.
const keepFocus = (event: React.MouseEvent) => event.preventDefault();

export function Toolbar() {
  const mode = useSession((s) => s.mode);
  const zoom = useCamera((c) => c.z);
  const count = useBoard((s) => s.screens.length);

  return (
    <>
      <div className="dock" role="radiogroup" aria-label="Mode">
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            role="radio"
            aria-checked={mode === m.mode}
            title={m.hint}
            className={mode === m.mode ? "dock-item on" : "dock-item"}
            onMouseDown={keepFocus}
            onClick={() => setMode(m.mode)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d={m.icon} />
            </svg>
            <span>{m.label}</span>
            <kbd>{m.shortcut}</kbd>
          </button>
        ))}
      </div>

      <div className="corner">
        <div className="zoom">
          <button type="button" aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onMouseDown={keepFocus} onClick={() => zoomAtCentre(zoom / 1.25)}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3.5 7.25h9v1.5h-9z" />
            </svg>
          </button>
          <button type="button" className="zoom-value" title="Zoom to 100%" onMouseDown={keepFocus} onClick={() => zoomAtCentre(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onMouseDown={keepFocus} onClick={() => zoomAtCentre(zoom * 1.25)}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M7.25 3.5h1.5v3.75h3.75v1.5H8.75v3.75h-1.5V8.75H3.5v-1.5h3.75z" />
            </svg>
          </button>
          <button type="button" className="zoom-fit" title="Fit the board (Shift+1)" disabled={!count} onMouseDown={keepFocus} onClick={() => zoomToFit(count)}>
            Fit
          </button>
        </div>
        {DEV && <DevMenu />}
      </div>
    </>
  );
}

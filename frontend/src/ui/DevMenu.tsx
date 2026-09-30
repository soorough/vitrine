// Dev only: trigger each failure on demand, and watch what gets reported.

import { useState } from "react";
import { arm, setApiKnob, useChaos, useReports, type ChaosPoint } from "../core/chaos";
import { loadBoard, retryPreview } from "../core/commands";
import { getConnection } from "../core/connection";
import { useBoard } from "../state/board";
import { useSession } from "../state/session";

export function DevMenu() {
  const [open, setOpen] = useState(false);
  const activeId = useSession((s) => s.activeId);
  const screens = useBoard((s) => s.screens);
  const armed = useChaos((s) => s.armed);
  const api = useChaos((s) => s.api);
  const reports = useReports((s) => s.entries);
  const target = screens.find((s) => s.id === activeId) ?? screens[0];

  const Arm = ({ point, children, scoped }: { point: ChaosPoint; children: string; scoped?: boolean }) => (
    <button type="button" className={armed[point] ? "dev-action armed" : "dev-action"} onClick={() => arm(point, scoped ? target?.id : undefined)}>
      {children}
    </button>
  );
  const Action = ({ onClick, children }: { onClick: () => void; children: string }) => (
    <button type="button" className="dev-action" onClick={onClick}>
      {children}
    </button>
  );

  return (
    <div className="dev">
      <button type="button" className={open ? "dev-toggle on" : "dev-toggle"} aria-expanded={open} onClick={() => setOpen(!open)}>
        Failures
        {reports.length > 0 && <span className="dev-count">{reports.length}</span>}
      </button>
      {open && (
        <div className="dev-menu">
          <section>
            <h3>Board</h3>
            <Action
              onClick={() => {
                setApiKnob("screens", { failNext: true });
                loadBoard();
              }}
            >
              Reload, and fail the screens request
            </Action>
            <Action onClick={loadBoard}>Reload the board</Action>
            <Arm point="board-render">Throw while rendering the board</Arm>
          </section>

          <section>
            <h3>Preview: {target?.name ?? "none"}</h3>
            <Action onClick={() => target && retryPreview(target.id, "missing")}>Load a page that does not exist</Action>
            <Action onClick={() => target && retryPreview(target.id, "mute")}>Reload with a script that never answers (10s)</Action>
            <Action onClick={() => target && getConnection(target.id)?.send({ t: "debug", action: "throw" })}>
              Throw an error inside the page
            </Action>
            <Arm point="preview-render" scoped>Throw while rendering the preview</Arm>
            <Arm point="preview-draw" scoped>Throw while drawing outlines</Arm>
            <Arm point="preview-click" scoped>Throw on the next click</Arm>
            <Arm point="preview-message" scoped>Throw on the next message from the page</Arm>
            <Arm point="preview-timer" scoped>Throw in the next pointer timer</Arm>
            <Arm point="preview-response" scoped>Throw when the next click is answered</Arm>
            <Arm point="key">Throw on the next shortcut key</Arm>
          </section>

          <section>
            <h3>Layers</h3>
            <Arm point="drop-children">Lose the next request for a row's children (3s)</Arm>
            <Arm point="layers-render">Throw while rendering the panel</Arm>
          </section>

          <section>
            <h3>Inspector</h3>
            <Action onClick={() => setApiKnob("details", { failNext: true })}>
              {api.details.failNext ? "Next details request will fail" : "Fail the next details request"}
            </Action>
            <Arm point="details-response">Throw when details arrive</Arm>
            <label className="dev-field">
              Details delay
              <select value={api.details.latency} onChange={(e) => setApiKnob("details", { latency: Number(e.target.value) })}>
                <option value={0}>None</option>
                <option value={1500}>1.5 seconds</option>
                <option value={4000}>4 seconds</option>
              </select>
            </label>
            <Arm point="inspector-render">Throw while rendering the inspector</Arm>
          </section>

          <section>
            <h3>Reported ({reports.length})</h3>
            {reports.length === 0 && <p className="dev-note">Nothing has been reported.</p>}
            <ol className="dev-reports">
              {reports.map((r, i) => (
                <li key={i}>
                  <b>{r.region}</b> {r.screenId ?? "board"}
                  {r.elementKey ? ` ${r.elementKey}` : ""}
                  <span>{r.message}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </div>
  );
}

import { useEffect } from "react";
import { getBoardScope, handleKey, loadBoard, pointerLeave, setMeasuring } from "../core/commands";
import { disarm } from "../core/chaos";
import { useBoard } from "../state/board";
import { Board, BoardError } from "./Board";
import { Inspector } from "./Inspector";
import { LayersPanel } from "./LayersPanel";
import { Boundary } from "./Region";
import { Toasts } from "./Toasts";
import { Toolbar } from "./Toolbar";

const isTyping = (target: EventTarget | null) =>
  !!(target as HTMLElement | null)?.matches?.("input, textarea, select, [contenteditable='true']");

export function App() {
  const boardStatus = useBoard((s) => s.status);
  const boardAttempt = useBoard((s) => s.attempt);
  useEffect(() => {
    loadBoard();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Alt") {
        setMeasuring(true);
        event.preventDefault();
        return;
      }
      if (isTyping(event.target)) return;
      if (handleKey({ key: event.key, shift: event.shiftKey, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey })) {
        event.preventDefault();
      }
    };
    // The pointer left the window: nothing is hovered any more.
    const onLeave = (event: MouseEvent) => {
      if (!event.relatedTarget) pointerLeave();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Alt") setMeasuring(false);
    };
    const onBlur = () => {
      pointerLeave();
      setMeasuring(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("mouseout", onLeave);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("mouseout", onLeave);
    };
  }, []);

  return (
    <div className="app">
      <LayersPanel />
      <main className="stage">
        {boardStatus === "error" ? (
          <BoardError />
        ) : (
          <Boundary
            key={boardAttempt}
            onError={(error) => {
              disarm("board-render");
              useBoard.setState({ crashed: true });
              getBoardScope()?.fail(error);
            }}
          >
            <Board />
          </Boundary>
        )}
        <Toolbar />
        <Toasts />
        <Inspector />
      </main>
    </div>
  );
}

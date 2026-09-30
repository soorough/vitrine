import { useEffect, useLayoutEffect, useRef } from "react";
import type { Screen } from "../core/api";
import { disarm, isArmed, useChaos } from "../core/chaos";
import { clearSelection, getBoardScope, loadBoard, pointerLeave, retryPreview, wheelFactor } from "../core/commands";
import { Scope } from "../core/regions";
import { getConnection } from "../core/connection";
import { patchPreview, useBoard } from "../state/board";
import { boardSize, FRAME_H, FRAME_W, framePosition, GAP_X, MIN_ZOOM, panBy, useCamera, zoomBy } from "../state/camera";
import { Overlays } from "./Overlay";
import { Preview } from "./Preview";
import { Boundary, RegionError } from "./Region";

const DOT_SPACING = 80;

export function Board() {
  const status = useBoard((s) => s.status);
  const screens = useBoard((s) => s.screens);
  useChaos((s) => s.armed["board-render"]);
  if (isArmed("board-render")) throw new Error("Injected failure (board-render)");
  const board = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);

  // The camera is applied straight to the DOM. Panning and zooming touch two
  // style properties and re-render none of the 24 previews.
  useLayoutEffect(() => {
    let settle = 0;
    const apply = ({ x, y, z } = useCamera.getState()) => {
      const el = board.current;
      if (!el || !world.current) return;
      // While moving, the previews are one composited layer and only slide.
      // Once still, the layer is dropped so they redraw sharp at the new zoom.
      el.classList.add("moving");
      clearTimeout(settle);
      settle = window.setTimeout(() => el.classList.remove("moving"), 180);
      world.current.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
      el.style.setProperty("--z", String(z));
      el.style.backgroundPosition = `${x}px ${y}px`;
      el.style.backgroundSize = `${DOT_SPACING * z}px ${DOT_SPACING * z}px`;
    };
    apply();
    const stop = useCamera.subscribe(apply);
    return () => {
      stop();
      clearTimeout(settle);
    };
  }, [status]);

  // Start zoomed so that three previews fit across.
  useLayoutEffect(() => {
    const el = board.current;
    if (status !== "ready" || !el) return;
    const z = Math.min(1, Math.max(MIN_ZOOM, el.clientWidth / (3 * (FRAME_W + GAP_X))));
    useCamera.setState({ x: 72, y: 96, z });
  }, [status]);

  useEffect(() => {
    const el = board.current;
    if (!el) return;
    const measure = () => {
      boardSize.width = el.clientWidth;
      boardSize.height = el.clientHeight;
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(el);

    // A two-finger swipe is a stream of wheel events. Like a browser does for
    // nested scrollers, the whole stream goes to whatever it started on: a
    // swipe that starts on the board keeps panning when a preview slides under
    // the pointer, and one that starts in a page keeps scrolling that page.
    // The stream ends after a short pause, which trackpad momentum does not
    // have, so a flick carries on to its end.
    //
    // A new swipe over a preview scrolls that page only once the board has
    // been still for a moment. Someone swiping across the board lifts their
    // fingers between swipes; they are still travelling, and a preview that
    // happens to be under the pointer should not catch them.
    const GESTURE_GAP = 160;
    const ARRIVED = 500;
    let latch: { kind: "pan" | "zoom" | "page" | "none"; screenId?: string } | null = null;
    let latchEnds = 0;
    let release = 0;
    let settled = 0;
    let movedAt = -Infinity;
    // Trackpads report wheel events faster than the screen redraws. Deltas
    // for a page are added up and sent once per frame.
    let pendingScroll: { screenId: string; x: number; y: number; dx: number; dy: number } | null = null;
    let scrollFrame = 0;
    const flushScroll = () => {
      scrollFrame = 0;
      const p = pendingScroll;
      pendingScroll = null;
      if (p) getConnection(p.screenId)?.send({ t: "scroll", x: p.x, y: p.y, dx: p.dx, dy: p.dy });
    };
    const stopWatching = useCamera.subscribe(() => {
      movedAt = performance.now();
    });

    const target = (event: WheelEvent): NonNullable<typeof latch> => {
      if (event.ctrlKey || event.metaKey) return { kind: "zoom" };
      if (performance.now() - movedAt < ARRIVED) return { kind: "pan" };
      const hit = (event.target as HTMLElement).closest<HTMLElement>("[data-hit]");
      if (hit) return { kind: "page", screenId: hit.dataset.hit };
      // A preview that is connecting, failed, or in Interact mode.
      if ((event.target as HTMLElement).closest(".frame-body")) return { kind: "none" };
      return { kind: "pan" };
    };

    // Wheel needs a non-passive listener to stop the browser's own zoom.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      getBoardScope()?.run(() => {
        const now = performance.now();
        const zooming = event.ctrlKey || event.metaKey;
        // Pressing or letting go of Ctrl/Cmd starts a new gesture.
        if (!latch || now > latchEnds || zooming !== (latch.kind === "zoom")) latch = target(event);
        latchEnds = now + GESTURE_GAP;

        // While the board itself is being moved: previews let the wheel through
        // for the rest of this swipe only (so Interact-mode pages don't take
        // it), and the cursor shows a hand until a new swipe would scroll a
        // page again.
        if (latch.kind === "pan" || latch.kind === "zoom") {
          el.classList.add("wheeling", "settling");
          clearTimeout(release);
          clearTimeout(settled);
          release = window.setTimeout(() => el.classList.remove("wheeling"), GESTURE_GAP);
          settled = window.setTimeout(() => el.classList.remove("settling"), ARRIVED);
        }

        const rect = el.getBoundingClientRect();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
        if (latch.kind === "zoom") {
          pointerLeave();
          zoomBy(wheelFactor(event.deltaY * unit), event.clientX - rect.left, event.clientY - rect.top);
        } else if (latch.kind === "pan") {
          pointerLeave();
          panBy(-event.deltaX * unit, -event.deltaY * unit);
        } else if (latch.kind === "page") {
          // Over a preview in Select mode the wheel belongs to that page. The
          // hit layer swallowed it, so it is replayed inside the page.
          const hit = el.querySelector<HTMLElement>(`[data-hit="${latch.screenId}"]`);
          if (!hit) return void (latch = null);
          const r = hit.getBoundingClientRect();
          const k = FRAME_W / r.width;
          const x = (event.clientX - r.left) * k;
          const y = (event.clientY - r.top) * k;
          if (pendingScroll && pendingScroll.screenId !== latch.screenId) flushScroll();
          if (pendingScroll) {
            pendingScroll.x = x;
            pendingScroll.y = y;
            pendingScroll.dx += event.deltaX * unit;
            pendingScroll.dy += event.deltaY * unit;
          } else {
            pendingScroll = { screenId: latch.screenId!, x, y, dx: event.deltaX * unit, dy: event.deltaY * unit };
          }
          scrollFrame ||= requestAnimationFrame(flushScroll);
        }
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    // Nothing may scroll the board itself: it moves only through the camera.
    const pin = () => {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    };
    el.addEventListener("scroll", pin);
    return () => {
      resize.disconnect();
      el.removeEventListener("wheel", onWheel);
      clearTimeout(release);
      clearTimeout(settled);
      cancelAnimationFrame(scrollFrame);
      stopWatching();
      el.removeEventListener("scroll", pin);
    };
  }, [status]);

  // Dragging empty board space pans; a click on it clears the selection.
  const drag = useRef<{ x: number; y: number; moved: boolean; onTitle: boolean } | null>(null);
  const guard = <E,>(fn: (event: E) => void) => (event: E) => void getBoardScope()?.run(() => fn(event));

  const onPointerDown = guard((event: React.PointerEvent<HTMLDivElement>) => {
    // The preview's name and its error badge are controls (double-click to
    // zoom, hover for the message), so they never start a pan.
    if (event.button !== 0 || (event.target as HTMLElement).closest(".frame-body, button, .frame-name, .page-error")) return;
    // A preview's title can start a pan, but clicking it is not a click on
    // empty board space, so it does not clear the selection.
    const onTitle = !!(event.target as HTMLElement).closest(".frame-title");
    drag.current = { x: event.clientX, y: event.clientY, moved: false, onTitle };
    event.currentTarget.setPointerCapture(event.pointerId);
  });
  const onPointerMove = guard((event: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    if (!d.moved) {
      d.moved = true;
      pointerLeave();
      event.currentTarget.classList.add("panning");
    }
    d.x = event.clientX;
    d.y = event.clientY;
    panBy(dx, dy);
  });
  const onPointerUp = guard((event: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    event.currentTarget.classList.remove("panning");
    if (!d.moved && !d.onTitle) clearSelection();
  });

  if (status === "loading") {
    return (
      <div className="board-message">
        <p className="board-loading">Loading screens…</p>
      </div>
    );
  }

  return (
    <div
      ref={board}
      className="board"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div ref={world} className="world">
        {screens.map((screen, index) => (
          <PreviewSlot key={screen.id} screen={screen} index={index} />
        ))}
      </div>
      <Overlays />
    </div>
  );
}


/** Shown in place of the board when it failed. It sits outside the board's
 *  error boundary, so it can always be drawn, and its Retry starts a new load
 *  with a new boundary. */
export function BoardError() {
  const error = useBoard((s) => s.error);
  const crashed = useBoard((s) => s.crashed);
  return (
    <div className="board-message">
      <RegionError
        title={crashed ? "The board stopped working" : "Couldn't load the screens"}
        message={
          crashed
            ? "Retry reloads the board and every preview."
            : "The list of screens did not arrive, so there is nothing to show yet."
        }
        detail={error ?? undefined}
        onRetry={loadBoard}
      />
    </div>
  );
}

/**
 * One preview inside its own error boundary: a preview that breaks while
 * rendering fails alone, shows its error in place, and Retry remounts it.
 */
function PreviewSlot({ screen, index }: { screen: Screen; index: number }) {
  const attempt = useBoard((s) => s.previews[screen.id]?.attempt ?? 0);
  return (
    <Boundary
      key={attempt}
      onError={(error) => {
        disarm("preview-render");
        const connection = getConnection(screen.id);
        if (connection?.scope.open) connection.scope.fail(error);
        else
          new Scope({ region: "preview", screenId: screen.id }, () =>
            patchPreview(screen.id, {
              status: "error",
              error: {
                title: "This preview stopped working",
                message: "Retry reloads only this preview. The rest of the board is unaffected.",
                detail: error.message,
                soft: false,
              },
            }),
          ).fail(error);
      }}
      fallback={<CrashedPreview screen={screen} index={index} />}
    >
      <Preview screen={screen} index={index} />
    </Boundary>
  );
}

function CrashedPreview({ screen, index }: { screen: Screen; index: number }) {
  const error = useBoard((s) => s.previews[screen.id]?.error);
  const position = framePosition(index);
  return (
    <section className="frame" style={{ left: position.x, top: position.y }}>
      <header className="frame-title">
        <span className="frame-name">{screen.name}</span>
      </header>
      <div className="frame-body" style={{ width: FRAME_W, height: FRAME_H }}>
        <div className="cover failed">
          <div className="cover-text">
            <RegionError
              title={error?.title ?? "This preview stopped working"}
              message={error?.message}
              detail={error?.detail}
              onRetry={() => retryPreview(screen.id)}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

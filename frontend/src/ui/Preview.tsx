import { memo, useEffect, useRef } from "react";
import type { Screen } from "../core/api";
import { focusPreview, pickAt, pointerLeave, pointerMove, retryPreview } from "../core/commands";
import { isArmed, useChaos } from "../core/chaos";
import { PreviewConnection } from "../core/connection";
import { useBoard } from "../state/board";
import { FRAME_H, FRAME_W, framePosition } from "../state/camera";
import { useSession } from "../state/session";
import { RegionError } from "./Region";

export const Preview = memo(function Preview({ screen, index }: { screen: Screen; index: number }) {
  const preview = useBoard((s) => s.previews[screen.id]);
  const selecting = useSession((s) => s.mode === "select");
  const active = useSession((s) => s.activeId === screen.id);
  const iframe = useRef<HTMLIFrameElement>(null);
  useChaos((s) => s.armed["preview-render"]);

  const attempt = preview?.attempt ?? 0;
  const sabotage = preview?.sabotage ?? null;
  const src = sabotage === "missing" ? new URL("/no-such-page.html", screen.url).href : screen.url;

  // One connection per attempt. Retry bumps `attempt`, which replaces the
  // iframe (it is keyed on it) and the connection together.
  useEffect(() => {
    if (!iframe.current) return;
    const connection = new PreviewConnection(screen, iframe.current, src, sabotage === "mute");
    return () => connection.dispose();
  }, [screen, attempt, src, sabotage]);

  if (!preview) return null;
  if (isArmed("preview-render", screen.id)) throw new Error("Injected failure (preview-render)");
  const position = framePosition(index);

  /** Pointer position in the page's own pixels, whatever the zoom. */
  const at = (event: React.MouseEvent<HTMLElement>, fn: (x: number, y: number) => void) => {
    const r = event.currentTarget.getBoundingClientRect();
    const k = FRAME_W / r.width;
    fn((event.clientX - r.left) * k, (event.clientY - r.top) * k);
  };

  return (
    <section className={active ? "frame active" : "frame"} style={{ left: position.x, top: position.y }}>
      <header className="frame-title">
        <span className="frame-name" title="Double-click to zoom in" onDoubleClick={() => focusPreview(screen.id)}>
          {screen.name}
        </span>
        {preview.pageErrors.length > 0 && (
          <span className="page-error" tabIndex={0}>
            Page error{preview.pageErrors.length > 1 ? ` ×${preview.pageErrors.length}` : ""}
            <span className="page-error-tip" role="tooltip">
              {preview.pageErrors[preview.pageErrors.length - 1]}
            </span>
          </span>
        )}
      </header>

      <div className="frame-body" style={{ width: FRAME_W, height: FRAME_H }}>
        <iframe
          key={attempt}
          ref={iframe}
          src={src}
          title={screen.name}
          width={FRAME_W}
          height={FRAME_H}
          tabIndex={selecting ? -1 : 0}
        />

        {/* Select mode: this layer takes every pointer event, so none can
            reach the page. The agent is only asked what lies under a point. */}
        {selecting && preview.status === "ready" && (
          <div
            className="hit"
            data-hit={screen.id}
            onPointerMove={(e) => at(e, (x, y) => pointerMove(screen.id, x, y))}
            onPointerLeave={pointerLeave}
            onClick={(e) => at(e, (x, y) => pickAt(screen.id, x, y, e.shiftKey))}
          />
        )}

        {preview.status === "connecting" && (
          <div className="cover">
            <p className="cover-text">Connecting…</p>
          </div>
        )}
        {preview.status === "error" && preview.error && (
          <div className={preview.error.soft ? "cover failed soft" : "cover failed"}>
            <div className="cover-text">
              <RegionError
                title={preview.error.title}
                message={preview.error.message}
                detail={preview.error.detail}
                onRetry={() => retryPreview(screen.id)}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
});

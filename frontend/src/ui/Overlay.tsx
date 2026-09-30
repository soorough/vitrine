// Outlines and labels. They are drawn by the host, in screen pixels, in a
// layer above the scaled board: that is what keeps a line 1px or 2px thick
// and a label the same size at every zoom level.

import { disarm, isArmed, useChaos } from "../core/chaos";
import { getConnection } from "../core/connection";
import { useBoard } from "../state/board";
import { FRAME_H, FRAME_W, framePosition, useCamera } from "../state/camera";
import { useGeometry } from "../state/page";
import { useSession } from "../state/session";
import type { Box, Geometry } from "../shared/protocol";
import { Boundary } from "./Region";

const LABEL_H = 18;

export function Overlays() {
  const selecting = useSession((s) => s.mode === "select");
  const selected = useSession((s) => s.selection?.screenId);
  const hovered = useSession((s) => s.hover?.screenId);
  const screens = useBoard((s) => s.screens);
  const previews = useBoard((s) => s.previews);
  if (!selecting) return null;

  return (
    <div className="overlays">
      {screens.map((screen, index) => {
        const preview = previews[screen.id];
        if ((screen.id !== selected && screen.id !== hovered) || preview?.status !== "ready") return null;
        return (
          // A throw while drawing one preview's outlines fails that preview.
          <Boundary
            key={`${screen.id}:${preview.attempt}`}
            onError={(error) => {
              disarm("preview-draw");
              getConnection(screen.id)?.scope.fail(error);
            }}
          >
            <PreviewOverlay screenId={screen.id} index={index} />
          </Boundary>
        );
      })}
    </div>
  );
}

function PreviewOverlay({ screenId, index }: { screenId: string; index: number }) {
  const camera = useCamera();
  const geometry = useGeometry((s) => s[screenId]);
  const selection = useSession((s) => (s.selection?.screenId === screenId ? s.selection.items : null));
  const hover = useSession((s) => (s.hover?.screenId === screenId ? s.hover.id : null));
  const measuring = useSession((s) => s.measuring);
  useChaos((s) => s.armed["preview-draw"]);
  if (isArmed("preview-draw", screenId)) throw new Error("Injected failure (preview-draw)");

  const frame = framePosition(index);
  const z = camera.z;
  const width = Math.round(FRAME_W * z);
  const height = Math.round(FRAME_H * z);
  const isSelected = (id: number) => !!selection?.some((i) => i.id === id);

  return (
    // Clipped to the preview's edges.
    <div
      className="overlay"
      style={{
        transform: `translate(${Math.round(camera.x + frame.x * z)}px, ${Math.round(camera.y + frame.y * z)}px)`,
        width,
        height,
      }}
    >
      {selection?.map((item) => {
        const g = geometry?.[item.id];
        return (
          g && (
            <Outline
              key={item.id}
              g={g}
              z={z}
              width={width}
              height={height}
              kind="selected"
              // Measuring puts its own numbers there.
              size={selection.length === 1 && !measuring}
            />
          )
        );
      })}
      {hover !== null && !isSelected(hover) && geometry?.[hover] && (
        <Outline g={geometry[hover]} z={z} width={width} height={height} kind="hover" />
      )}
      {measuring && selection && hover !== null && !isSelected(hover) && (
        <Distances
          from={geometry?.[selection[selection.length - 1].id]?.box}
          to={geometry?.[hover]?.box}
          z={z}
        />
      )}
    </div>
  );
}

function Outline(props: {
  g: Geometry;
  z: number;
  width: number;
  height: number;
  kind: "hover" | "selected";
  size?: boolean;
}) {
  const { g, z, width, height, kind, size } = props;
  // Nothing of the element is visible: scrolled away, or cut by a scroller.
  if (!g.clip) return null;

  const left = Math.round(g.box.x * z);
  const top = Math.round(g.box.y * z);
  const right = Math.max(left + 1, Math.round((g.box.x + g.box.w) * z));
  const bottom = Math.max(top + 1, Math.round((g.box.y + g.box.h) * z));

  // The visible part: what scroll containers inside the page let through.
  const vLeft = Math.round(g.clip.x * z);
  const vTop = Math.round(g.clip.y * z);
  const vRight = Math.max(vLeft + 1, Math.round((g.clip.x + g.clip.w) * z));
  const vBottom = Math.max(vTop + 1, Math.round((g.clip.y + g.clip.h) * z));

  // Label above the element; below it when there is no room above inside the
  // preview; inside its top edge when there is no room either side.
  const labelTop = vTop - LABEL_H >= 0 ? vTop - LABEL_H : vBottom + LABEL_H <= height ? vBottom : vTop;
  // Width × height under the element, as in Figma, when the name is not there.
  const sizeTop = vBottom + 4;
  const showSize = size && labelTop !== vBottom && sizeTop + LABEL_H <= height;

  return (
    <>
      <div className="outline-window" style={{ left: vLeft, top: vTop, width: vRight - vLeft, height: vBottom - vTop }}>
        <div
          className={`outline ${kind}`}
          style={{ left: left - vLeft, top: top - vTop, width: right - left, height: bottom - top }}
        />
      </div>
      <div
        className={`outline-label ${kind}`}
        style={{
          left: vLeft,
          top: labelTop,
          maxWidth: width,
          // Slide left rather than run past the preview's right edge.
          transform: `translateX(min(0px, calc(${width - vLeft}px - 100%)))`,
        }}
      >
        {g.name}
      </div>
      {showSize && (
        <div
          className="outline-size"
          style={{ left: (vLeft + vRight) / 2, top: sizeTop }}
        >
          {Math.round(g.box.w)} × {Math.round(g.box.h)}
        </div>
      )}
    </>
  );
}

interface Span {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  value: number;
}

/** Gaps between two boxes, in page pixels: the space between them where they
 *  do not overlap, and edge to edge where one sits inside the other. */
export function spans(a: Box, b: Box): Span[] {
  const out: Span[] = [];
  const ar = a.x + a.w;
  const ab = a.y + a.h;
  const br = b.x + b.w;
  const bb = b.y + b.h;
  const cy = a.y + a.h / 2;
  const cx = a.x + a.w / 2;
  const across = (x1: number, x2: number) => x2 - x1 >= 0.5 && out.push({ x1, x2, y1: cy, y2: cy, value: x2 - x1 });
  const down = (y1: number, y2: number) => y2 - y1 >= 0.5 && out.push({ x1: cx, x2: cx, y1, y2, value: y2 - y1 });

  if (ar <= b.x) across(ar, b.x);
  else if (br <= a.x) across(br, a.x);
  else {
    across(Math.min(a.x, b.x), Math.max(a.x, b.x));
    across(Math.min(ar, br), Math.max(ar, br));
  }
  if (ab <= b.y) down(ab, b.y);
  else if (bb <= a.y) down(bb, a.y);
  else {
    down(Math.min(a.y, b.y), Math.max(a.y, b.y));
    down(Math.min(ab, bb), Math.max(ab, bb));
  }
  return out;
}

/** Hold Alt with something selected: distances to the element under the pointer. */
function Distances({ from, to, z }: { from?: Box; to?: Box; z: number }) {
  if (!from || !to) return null;
  return (
    <>
      {spans(from, to).map((s, i) => {
        const horizontal = s.y1 === s.y2;
        const left = Math.round(s.x1 * z);
        const top = Math.round(s.y1 * z);
        return (
          <div key={i}>
            <div
              className={horizontal ? "measure-line across" : "measure-line down"}
              style={
                horizontal
                  ? { left, top, width: Math.max(1, Math.round(s.x2 * z) - left) }
                  : { left, top, height: Math.max(1, Math.round(s.y2 * z) - top) }
              }
            />
            <div
              className="measure-value"
              style={{ left: Math.round(((s.x1 + s.x2) / 2) * z), top: Math.round(((s.y1 + s.y2) / 2) * z) }}
            >
              {Math.round(s.value)}
            </div>
          </div>
        );
      })}
    </>
  );
}

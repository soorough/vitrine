import type { Box, Geometry, Live } from "../shared/protocol";

export function nameOf(el: Element): string {
  const given = el.getAttribute("data-name");
  if (given) return given;
  const tag = el.localName;
  // getAttribute, not className: SVG elements have an object there.
  const first = (el.getAttribute("class") ?? "").trim().split(/\s+/)[0];
  if (first) return `${tag}.${first}`;
  if (el.id) return `${tag}#${el.id}`;
  return tag;
}

export function liveOf(el: Element): Live {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    name: nameOf(el),
    tag: el.localName,
    id: el.id,
    classes: (el.getAttribute("class") ?? "").trim().split(/\s+/).filter(Boolean),
    width: Math.round(r.width),
    height: Math.round(r.height),
    x: Math.round(r.left + window.scrollX),
    y: Math.round(r.top + window.scrollY),
    text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
    color: cs.color,
    background: cs.backgroundColor,
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    key: el.getAttribute("data-key"),
    anchor: el.hasAttribute("data-key") ? "key" : el.id ? "id" : "content",
  };
}

// Which ancestors clip an element only changes when the DOM or styles do, so
// the list is cached and dropped on any mutation.
let clippers = new WeakMap<Element, Element[]>();
export function clearClipCache() {
  clippers = new WeakMap();
}

function clippersOf(el: Element): Element[] {
  let list = clippers.get(el);
  if (list) return list;
  list = [];
  const root = document.documentElement;
  for (let p = el.parentElement; p && p !== root && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflowX !== "visible" || cs.overflowY !== "visible") list.push(p);
  }
  clippers.set(el, list);
  return list;
}

const round = (n: number) => Math.round(n * 100) / 100;

function intersect(a: Box, b: Box): Box | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return r > x && bottom > y ? { x, y, w: r - x, h: bottom - y } : null;
}

/** Null when the element has no box at all (display: none, <script>, …). */
export function measure(el: Element): Geometry | null {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  const box: Box = { x: round(r.left), y: round(r.top), w: round(r.width), h: round(r.height) };
  const root = document.documentElement;
  let clip: Box | null = intersect(box, { x: 0, y: 0, w: root.clientWidth, h: root.clientHeight });
  for (const p of clippersOf(el)) {
    if (!clip) break;
    const pr = p.getBoundingClientRect();
    clip = intersect(clip, { x: pr.left + p.clientLeft, y: pr.top + p.clientTop, w: p.clientWidth, h: p.clientHeight });
  }
  if (clip) clip = { x: round(clip.x), y: round(clip.y), w: round(clip.w), h: round(clip.h) };
  return { name: nameOf(el), box, clip };
}

/** Brings an element into view by scrolling containers inside this document
 *  only. Element.scrollIntoView is avoided on purpose: it also scrolls the
 *  embedding page, which would move the board. */
export function reveal(el: Element) {
  const centre = (start: number, size: number, viewStart: number, viewSize: number) =>
    start >= viewStart && start + size <= viewStart + viewSize ? 0 : start + size / 2 - (viewStart + viewSize / 2);

  for (const p of clippersOf(el)) {
    const r = el.getBoundingClientRect();
    const pr = p.getBoundingClientRect();
    p.scrollTop += centre(r.top, Math.min(r.height, p.clientHeight), pr.top + p.clientTop, p.clientHeight);
    p.scrollLeft += centre(r.left, Math.min(r.width, p.clientWidth), pr.left + p.clientLeft, p.clientWidth);
  }
  const r = el.getBoundingClientRect();
  const root = document.documentElement;
  window.scrollBy({
    top: centre(r.top, Math.min(r.height, root.clientHeight), 0, root.clientHeight),
    left: centre(r.left, Math.min(r.width, root.clientWidth), 0, root.clientWidth),
    behavior: "instant",
  });
}

/** Wheel scrolling, replayed from the host: the innermost scroller under the
 *  point that can still move takes the delta, per axis. */
export function scrollAt(x: number, y: number, dx: number, dy: number) {
  let doneX = dx === 0;
  let doneY = dy === 0;
  for (let n = document.elementFromPoint(x, y); n && !(doneX && doneY); n = n.parentElement) {
    if (n === document.body || n === document.documentElement) break;
    const cs = getComputedStyle(n);
    if (!doneY && /auto|scroll/.test(cs.overflowY) && n.scrollHeight > n.clientHeight) {
      const before = n.scrollTop;
      n.scrollTop += dy;
      doneY = n.scrollTop !== before;
    }
    if (!doneX && /auto|scroll/.test(cs.overflowX) && n.scrollWidth > n.clientWidth) {
      const before = n.scrollLeft;
      n.scrollLeft += dx;
      doneX = n.scrollLeft !== before;
    }
  }
  if (!doneX || !doneY) window.scrollBy({ left: doneX ? 0 : dx, top: doneY ? 0 : dy, behavior: "instant" });
}

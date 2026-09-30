// The agent: the one script each page loads. It answers the host's questions
// about this document and tells it what changes. It never draws anything and
// never changes the page's DOM.

import {
  TAG,
  type AgentBody,
  type ChildList,
  type Geometry,
  type HostMsg,
  type Id,
  type Live,
  type Method,
  type Mode,
  type NodeInfo,
  type Ref,
  type Requests,
  type SearchRow,
} from "../shared/protocol";
import { clearClipCache, liveOf, measure, nameOf, reveal, scrollAt } from "./describe";
import { Registry } from "./identity";

const MAX_SEARCH_ROWS = 3000;
const ROOT = 0;

function start() {
  const host = window.parent;
  // One id per document load. A navigation or reload is a new document.
  const doc = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const reg = new Registry();

  let hostOrigin: string | null = null;
  let mode: Mode = "select";

  const post = (body: AgentBody) => {
    host.postMessage({ figr: TAG, doc, ...body }, hostOrigin ?? "*");
  };

  const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

  /** The agent's own bugs are reported to the host, never thrown into the page. */
  const safe =
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A) => {
      try {
        fn(...args);
      } catch (e) {
        post({ t: "fault", message: messageOf(e) });
      }
    };

  // ── What the host is watching ───────────────────────────────────────────

  let pointer: { x: number; y: number } | null = null;
  let hoverEl: Element | null = null;
  let selected: Id[] = [];
  let panelHover: Id | null = null;
  const observed = new Set<Id>();
  const lastSent = new Map<Id, string>();
  let searching = false;

  const hit = (x: number, y: number): Element | null => {
    const el = document.elementFromPoint(x, y);
    return !el || el === document.documentElement || el === document.body ? null : el;
  };

  const refOf = (el: Element): Ref => {
    const ancestors: Id[] = [];
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      ancestors.unshift(reg.idFor(p));
    }
    return { id: reg.idFor(el), name: nameOf(el), ancestors };
  };

  const listOf = (el: Element): NodeInfo[] =>
    Array.from(el.children, (c) => ({
      id: reg.idFor(c),
      name: nameOf(c),
      tag: c.localName,
      hasChildren: c.childElementCount > 0,
    }));

  // ── The frame loop: hover, geometry and live values ─────────────────────
  // Polled once per frame while the host is watching something, and compared
  // against what was last sent. Scroll, resize, animation and layout changes
  // all show up as a changed rectangle, so none of them needs its own hook.

  // Exactly one frame callback may be pending. `tick` is also called directly
  // (after a scroll, a DOM change, a new watch list); those calls measure now
  // and leave the pending frame, if any, as it is.
  let pendingFrame = 0;
  let lastTick = 0;
  let frame = 0;
  let lastGeometry = "{}";
  let lastLive = "{}";
  let liveDirty = true;

  const tick = safe(() => {
    lastTick = performance.now();
    frame++;

    let hoverChanged = false;
    if (pointer && mode === "select") {
      const el = hit(pointer.x, pointer.y);
      if (el !== hoverEl) {
        hoverEl = el;
        hoverChanged = true;
      }
    }

    const ids = new Set(selected);
    if (panelHover !== null) ids.add(panelHover);
    if (hoverEl?.isConnected) ids.add(reg.idFor(hoverEl));

    const items: Record<Id, Geometry> = {};
    for (const id of ids) {
      const el = reg.get(id);
      const g = el && measure(el);
      if (g) items[id] = g;
    }
    const geometry = JSON.stringify(items);
    if (geometry !== lastGeometry || hoverChanged) {
      lastGeometry = geometry;
      liveDirty = true;
      // One message, so the new outline never waits a frame for its rectangle.
      if (hoverChanged) post({ t: "geometry", items, hover: hoverEl ? refOf(hoverEl) : null });
      else post({ t: "geometry", items });
    }

    if (selected.length && (liveDirty || frame % 20 === 0)) {
      liveDirty = false;
      const live: Record<Id, Live> = {};
      for (const id of selected) {
        const el = reg.get(id);
        if (el) live[id] = liveOf(el);
      }
      const serialised = JSON.stringify(live);
      if (serialised !== lastLive) {
        lastLive = serialised;
        post({ t: "live", items: live });
      }
    }

    if (pointer || ids.size) schedule();
  });

  function schedule() {
    if (pendingFrame) return;
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = 0;
      tick();
    });
  }

  // Browsers pause requestAnimationFrame in frames that are off screen. The
  // inspector can still be showing one, so keep a slow heartbeat going.
  setInterval(() => {
    if ((pointer || selected.length || panelHover !== null) && performance.now() - lastTick > 200) tick();
  }, 250);

  // ── The page changing under us ──────────────────────────────────────────

  let dirtyTimer = 0;
  const flushTree = (dirty: Set<Element>) => {
    const lists: ChildList[] = [];
    for (const el of dirty) {
      if (!el.isConnected) continue;
      const id = el === document.body ? ROOT : reg.peek(el);
      if (id === undefined || !observed.has(id)) continue;
      const children = listOf(el);
      const serialised = JSON.stringify(children);
      if (serialised === lastSent.get(id)) continue;
      lastSent.set(id, serialised);
      lists.push({ parent: id === ROOT ? null : id, children });
    }
    if (lists.length) post({ t: "tree", lists });
  };

  const observer = new MutationObserver(
    safe((records: MutationRecord[]) => {
      clearClipCache();
      liveDirty = true;

      // Identity first: everything below reads ids.
      const { dead, rebound } = reg.reconcile(records);

      const dirty = new Set<Element>();
      let structural = false;
      const touch = (node: Node | null) => {
        if (node && node.nodeType === 1) dirty.add(node as Element);
      };
      for (const r of records) {
        if (r.type === "childList") {
          structural = true;
          touch(r.target);
          touch(r.target.parentNode);
          if (r.target === document.documentElement) touch(document.body);
        } else if (r.type === "attributes" && /^(class|id|data-name)$/.test(r.attributeName ?? "")) {
          structural = true;
          touch(r.target.parentNode);
        }
      }
      for (const el of rebound) {
        touch(el);
        touch(el.parentNode);
      }

      if (dead.length) {
        const gone = new Set(dead);
        for (const id of dead) {
          observed.delete(id);
          lastSent.delete(id);
        }
        selected = selected.filter((id) => !gone.has(id));
        if (panelHover !== null && gone.has(panelHover)) panelHover = null;
        post({ t: "gone", ids: dead });
      }

      flushTree(dirty);

      if (structural && searching && !dirtyTimer) {
        dirtyTimer = window.setTimeout(() => {
          dirtyTimer = 0;
          post({ t: "dirty" });
        }, 250);
      }
      // Re-measure now, not next frame: a rebuilt element keeps its outline
      // without a gap.
      if (pointer || selected.length || panelHover !== null) tick();
    }),
  );
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });

  // ── Requests ────────────────────────────────────────────────────────────

  const handlers: { [M in Method]: (params: Requests[M]["params"]) => Requests[M]["result"] } = {
    pick: ({ x, y }) => {
      const el = hit(x, y);
      return el ? refOf(el) : null;
    },

    children: ({ id }) => {
      const el = id === null ? document.body : reg.get(id);
      // An element that vanished a moment ago has no children; the host's row
      // for it is removed by the `tree` and `gone` messages already on the way.
      if (!el) return [];
      const key = id ?? ROOT;
      const children = listOf(el);
      observed.add(key);
      lastSent.set(key, JSON.stringify(children));
      return children;
    },

    step: ({ id, dir }) => {
      const el = reg.get(id);
      if (!el) return null;
      if (dir === "child") return el.firstElementChild ? refOf(el.firstElementChild) : null;
      const parent = el.parentElement;
      if (!parent) return null;
      if (dir === "parent") return parent === document.body || parent === document.documentElement ? null : refOf(parent);
      const siblings = Array.from(parent.children);
      const at = siblings.indexOf(el) + (dir === "next" ? 1 : -1);
      return refOf(siblings[(at + siblings.length) % siblings.length]);
    },

    search: ({ query }) => {
      const q = query.trim().toLowerCase();
      searching = q !== "";
      if (!searching || !document.body) return { rows: [], truncated: false };

      // Depth-first over the whole document, keeping a row for every match
      // and every ancestor of a match. Ids are only handed out to kept rows.
      const kept: Array<{ el: Element; depth: number; name: string; match: boolean }> = [];
      let truncated = false;
      const visit = (el: Element, depth: number): boolean => {
        if (kept.length >= MAX_SEARCH_ROWS) {
          truncated = true;
          return false;
        }
        const name = nameOf(el);
        const match = name.toLowerCase().includes(q);
        const at = kept.length;
        kept.push({ el, depth, name, match });
        let inside = false;
        for (const child of el.children) inside = visit(child, depth + 1) || inside;
        if (!match && !inside) kept.length = at;
        return match || inside;
      };
      for (const child of document.body.children) visit(child, 0);

      const rows: SearchRow[] = kept.map(({ el, depth, name, match }) => ({
        id: reg.idFor(el),
        name,
        depth,
        match,
        tag: el.localName,
        hasChildren: el.childElementCount > 0,
        parent: el.parentElement && el.parentElement !== document.body ? reg.idFor(el.parentElement) : null,
      }));
      return { rows, truncated };
    },

    reveal: ({ id }) => {
      const el = reg.get(id);
      if (!el) return false;
      reveal(el);
      tick();
      return true;
    },
  };

  // ── Messages from the host ──────────────────────────────────────────────

  let helloTimer = 0;

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== host) return;
    const msg = event.data as HostMsg | null;
    if (!msg || msg.figr !== TAG || msg.doc !== doc) return;
    if (msg.t === "init") {
      hostOrigin = event.origin;
      clearInterval(helloTimer);
      for (const message of earlyErrors.splice(0)) post({ t: "pageerror", message });
    } else if (event.origin !== hostOrigin) {
      return;
    }

    if (msg.t === "req") {
      try {
        const data = (handlers[msg.method] as (p: unknown) => unknown)(msg.params);
        post({ t: "res", rid: msg.rid, ok: true, data });
      } catch (e) {
        post({ t: "res", rid: msg.rid, ok: false, error: messageOf(e) });
      }
      return;
    }

    safe(() => {
      switch (msg.t) {
        case "init":
        case "mode":
          mode = msg.mode;
          if (mode === "select") {
            // Whatever the user was typing into stops receiving keys.
            (document.activeElement as HTMLElement | null)?.blur?.();
          } else {
            pointer = null;
            hoverEl = null;
          }
          schedule();
          break;
        case "pointer":
          pointer = msg.at;
          if (!pointer) hoverEl = null;
          schedule();
          break;
        case "scroll":
          scrollAt(msg.x, msg.y, msg.dx, msg.dy);
          // Measure in the same task, so the outline moves with the content.
          tick();
          break;
        case "track": {
          const missing = [...msg.selected, ...(msg.hover === null ? [] : [msg.hover])].filter((id) => !reg.get(id));
          selected = msg.selected.filter((id) => reg.get(id));
          panelHover = msg.hover !== null && reg.get(msg.hover) ? msg.hover : null;
          liveDirty = true;
          lastLive = "";
          if (missing.length) post({ t: "gone", ids: missing });
          tick();
          break;
        }
        case "debug":
          // Thrown from a plain timer on purpose: it must look like the page's own bug.
          setTimeout(() => {
            throw new Error("Injected page error");
          });
          break;
      }
    })();
  });

  // ── Input ───────────────────────────────────────────────────────────────

  const isEditable = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    return !!el?.matches?.("input, textarea, select, [contenteditable=''], [contenteditable='true']");
  };

  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  // Keys pressed while this frame has focus never reach the host on their
  // own, so they are forwarded. In Select mode the page gets none of them.
  window.addEventListener(
    "keydown",
    (event) => {
      const editing = mode === "interact" && isEditable(event.target);
      if (!editing) {
        post({ t: "key", key: event.key, shift: event.shiftKey, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey });
      }
      if (mode === "select") swallow(event);
    },
    true,
  );

  // Select mode is enforced by the host's hit layer, which sits over this
  // frame. This is the second lock: if an event ever gets here, stop it.
  for (const type of [
    "keyup",
    "keypress",
    "pointerdown",
    "pointerup",
    "mousedown",
    "mouseup",
    "click",
    "dblclick",
    "auxclick",
    "contextmenu",
    "touchstart",
    "touchend",
    "dragstart",
    "submit",
  ]) {
    window.addEventListener(
      type,
      (event) => {
        if (mode === "select") swallow(event);
      },
      { capture: true, passive: false },
    );
  }

  // Ctrl/Cmd + wheel zooms the board, not the page.
  window.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
      post({ t: "zoom", x: event.clientX, y: event.clientY, dy: event.deltaY * unit });
    },
    { capture: true, passive: false },
  );

  // ── The page's own errors ───────────────────────────────────────────────

  // A page can fail while it is still loading, before the host knows this
  // document. Those errors are held and sent once the host has answered.
  const earlyErrors: string[] = [];
  const pageError = (message: string) => {
    if (hostOrigin) post({ t: "pageerror", message });
    else if (earlyErrors.length < 20) earlyErrors.push(message);
  };
  window.addEventListener("error", (event) => {
    if (event.message) pageError(event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    pageError(messageOf(event.reason));
  });

  // ── Lifecycle ───────────────────────────────────────────────────────────

  window.addEventListener("pagehide", () => post({ t: "bye" }));

  const hello = () => {
    const say = () => post({ t: "hello", url: location.href });
    say();
    // The host answers with `init`. Until it does, keep knocking.
    helloTimer = window.setInterval(say, 500);
    setTimeout(() => clearInterval(helloTimer), 12_000);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hello, { once: true });
  else hello();
}

declare global {
  interface Window {
    __figrAgent?: true;
  }
}

if (window.parent !== window && !window.__figrAgent) {
  window.__figrAgent = true;
  start();
}

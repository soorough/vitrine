import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { disarm, isArmed, useChaos } from "../core/chaos";
import { hoverRow, selectRow } from "../core/commands";
import {
  clearReveal,
  loadChildren,
  panelScope,
  retryPanel,
  scrollMemory,
  setExpanded,
  setQuery,
  toggleRow,
} from "../core/layers";
import { useBoard } from "../state/board";
import { buildRows, emptyLayers, useLayers, type Row } from "../state/layers";
import { useSession } from "../state/session";
import type { Id } from "../shared/protocol";
import { ElementIcon } from "./ElementIcon";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { Boundary, RegionError } from "./Region";

const ROW_H = 28;
const INDENT = 12;
const OVERSCAN = 8;
const EMPTY = emptyLayers();

export function LayersPanel() {
  const activeId = useSession((s) => s.activeId);
  const screen = useBoard((s) => s.screens.find((x) => x.id === activeId));
  const status = useBoard((s) => (activeId ? s.previews[activeId]?.status : undefined));
  const error = useLayers((s) => (activeId ? s[activeId]?.error : null) ?? null);
  const timedOut = useLayers((s) => (activeId ? s[activeId]?.errorWasTimeout : false) ?? false);
  const query = useLayers((s) => (activeId ? s[activeId]?.query : "") ?? "");
  const matches = useLayers((s) => (activeId ? s[activeId]?.results?.filter((r) => r.match).length : undefined));
  const url = useBoard((s) => (activeId ? s.previews[activeId]?.url : null));
  const path = screen ? new URL(url ?? screen.url).pathname.replace(/^\//, "") : "";

  let body;
  if (!activeId || !screen) {
    body = (
      <div className="panel-empty">
        <svg className="panel-empty-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 2l9.2 6.6-4 .7 2.3 4.3-1.7.9-2.3-4.3-3.5 2.5z" />
        </svg>
        <p>Click something in a preview</p>
        <p className="panel-empty-hint">Its page structure appears here.</p>
      </div>
    );
  } else if (status === "error") {
    body = (
      <div className="panel-empty">
        <p>This preview is not connected</p>
        <p className="panel-empty-hint">Retry it on the board to see its layers.</p>
      </div>
    );
  } else if (error) {
    body = (
      <RegionError
        title={timedOut ? "Couldn't load the layers" : "The layers panel stopped working"}
        message="The preview itself still works; only this panel is affected."
        detail={error}
        onRetry={() => retryPanel(activeId)}
      />
    );
  } else {
    body = (
      <Boundary
        key={activeId}
        onError={(e) => {
          disarm("layers-render");
          panelScope(activeId).fail(e);
        }}
      >
        <Tree screenId={activeId} />
      </Boundary>
    );
  }

  return (
    <aside className="panel layers">
      <div className="brand">
        <Logo />
        Vitrine
        <ThemeToggle />
      </div>
      <header className="panel-head">
        <h2>Layers</h2>
      </header>
      {screen && (
        <div className="page-card" title={url ?? screen.url}>
          <span className={`page-status ${status ?? "connecting"}`} aria-label={status ?? "connecting"} />
          <span className="page-card-name">{screen.name}</span>
          <span className="page-card-path">{path}</span>
        </div>
      )}
      <div className="search">
        <svg className="search-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M7 2.5a4.5 4.5 0 110 9 4.5 4.5 0 010-9zM10.3 10.3l3.2 3.2" />
        </svg>
        <input
          type="text"
          placeholder="Find a layer"
          aria-label="Find a layer by name"
          value={query}
          disabled={!activeId}
          onChange={(e) => activeId && setQuery(activeId, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && activeId) {
              setQuery(activeId, "");
              e.currentTarget.blur();
            }
          }}
        />
        {query && activeId && (
          <>
            {matches !== undefined && <span className="search-count">{matches}</span>}
            <button type="button" className="search-clear" aria-label="Clear search" onClick={() => setQuery(activeId, "")}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4.2 3.1L8 6.9l3.8-3.8 1.1 1.1L9.1 8l3.8 3.8-1.1 1.1L8 9.1l-3.8 3.8-1.1-1.1L6.9 8 3.1 4.2z" />
              </svg>
            </button>
          </>
        )}
      </div>
      {body}
      {activeId && status === "ready" && !error && (
        <footer className="panel-foot">
          <span title="Arrow up or down selects the row above or below">
            <kbd>↑</kbd>
            <kbd>↓</kbd> Move
          </span>
          <span title="Arrow right opens a row, arrow left closes it">
            <kbd>←</kbd>
            <kbd>→</kbd> Open
          </span>
          <span title="Hold Shift and click a row to add it to the selection, or to remove it">
            <kbd>⇧</kbd> Multi-select
          </span>
        </footer>
      )}
    </aside>
  );
}

function Tree({ screenId }: { screenId: string }) {
  const state = useLayers((s) => s[screenId]) ?? EMPTY;
  const selection = useSession((s) => (s.selection?.screenId === screenId ? s.selection.items : null));
  const hover = useSession((s) => (s.hover?.screenId === screenId ? s.hover : null));
  useChaos((s) => s.armed["layers-render"]);
  if (isArmed("layers-render")) throw new Error("Injected failure (layers-render)");

  const rows = useMemo(() => buildRows(state), [state.nodes, state.expanded, state.results]);
  const indexOf = useMemo(() => new Map(rows.map((row, i) => [row.id, i])), [rows]);

  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(600);
  const previous = useRef<Row[] | null>(null);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const before = previous.current;
    previous.current = rows;

    if (!before) {
      // Back on this preview: put the panel where it was left.
      el.scrollTop = scrollMemory.get(screenId) ?? 0;
    } else if (before !== rows && el.scrollTop > 0) {
      // The rows changed under the user. Keep the row at the top of the view
      // where it is by absorbing whatever was added or removed above it.
      const was = Math.floor(el.scrollTop / ROW_H);
      const now = before[was] && indexOf.get(before[was].id);
      if (now !== undefined && now !== was) el.scrollTop += (now - was) * ROW_H;
    }

    if (state.reveal !== null) {
      const at = indexOf.get(state.reveal);
      if (at !== undefined) {
        const top = at * ROW_H;
        if (top < el.scrollTop || top + ROW_H > el.scrollTop + el.clientHeight) {
          el.scrollTop = Math.max(0, top - el.clientHeight / 2 + ROW_H / 2);
        }
        const indent = rows[at].depth * INDENT;
        if (indent < el.scrollLeft || indent > el.scrollLeft + el.clientWidth - 120) el.scrollLeft = Math.max(0, indent - 40);
        clearReveal(screenId);
      } else if (state.results) {
        clearReveal(screenId);
      }
    }
    setScrollTop(el.scrollTop);
  }, [screenId, rows, indexOf, state.reveal, state.results]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const resize = new ResizeObserver(() => setViewHeight(el.clientHeight));
    resize.observe(el);
    return () => resize.disconnect();
  }, []);

  const selected = useMemo(() => new Set(selection?.map((i) => i.id)), [selection]);
  // Rows that hold a selected element somewhere inside them.
  const holders = useMemo(() => new Set(selection?.flatMap((i) => i.ancestors)), [selection]);
  // The hovered element's row, or its nearest ancestor that is on screen.
  const hoverRowId = useMemo(() => {
    if (!hover) return null;
    for (const id of [hover.id, ...[...hover.ancestors].reverse()]) if (indexOf.has(id)) return id;
    return null;
  }, [hover, indexOf]);

  const searching = state.results !== null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    const cursor = selection?.length ? indexOf.get(selection[selection.length - 1].id) : undefined;
    const row = cursor === undefined ? undefined : rows[cursor];
    const go = (id: Id | undefined) => id !== undefined && selectRow(screenId, id, false);

    if (event.key === "ArrowDown") go(rows[cursor === undefined ? 0 : Math.min(rows.length - 1, cursor + 1)]?.id);
    else if (event.key === "ArrowUp") go(rows[cursor === undefined ? 0 : Math.max(0, cursor - 1)]?.id);
    else if (event.key === "ArrowRight" && row && !searching) {
      if (row.hasChildren && !row.expanded) setExpanded(screenId, row.id, true);
      else if (row.expanded) go(state.nodes[row.id]?.children?.[0]);
    } else if (event.key === "ArrowLeft" && row && !searching) {
      if (row.expanded) setExpanded(screenId, row.id, false);
      else {
        const parent = state.nodes[row.id]?.parent;
        if (parent) go(parent);
      }
    } else return;
    event.preventDefault();
  };

  const root = state.nodes[0];
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewHeight) / ROW_H) + OVERSCAN);
  const needle = state.query.trim().toLowerCase();

  return (
    <div
      ref={scroller}
      className="tree"
      role="tree"
      aria-label="Layers"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseLeave={() => hoverRow(screenId, null)}
      onScroll={(e) => {
        setScrollTop(e.currentTarget.scrollTop);
        scrollMemory.set(screenId, e.currentTarget.scrollTop);
      }}
    >
      {rows.length === 0 && (
        <p className="panel-empty">
          {searching
            ? state.searching
              ? "Searching…"
              : `No layer is named like “${state.query.trim()}”`
            : root.children
              ? "This page has no elements"
              : "Loading layers…"}
        </p>
      )}
      <div className="tree-rows" style={{ height: rows.length * ROW_H, paddingTop: first * ROW_H }}>
        {rows.slice(first, last).map((row) => (
          <div
            key={row.id}
            role="treeitem"
            aria-selected={selected.has(row.id)}
            aria-expanded={row.hasChildren ? row.expanded : undefined}
            className={[
              "row",
              selected.has(row.id) && "selected",
              hoverRowId === row.id && "hovered",
              !row.match && "context",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ paddingLeft: 8 + row.depth * INDENT, ["--guides" as string]: `${row.depth * INDENT}px` }}
            onMouseEnter={() => hoverRow(screenId, row.id)}
            // Shift+click is multi-select here; stop the browser extending a text selection.
            onMouseDown={(e) => e.shiftKey && e.preventDefault()}
            onClick={(e) => selectRow(screenId, row.id, e.shiftKey)}
          >
            {row.load === "loading" ? (
              <span className="spinner" role="status" aria-label="Loading children" />
            ) : row.hasChildren && !searching ? (
              <button
                type="button"
                className={row.expanded ? "chevron open" : "chevron"}
                aria-label={row.expanded ? "Collapse" : "Expand"}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleRow(screenId, row.id);
                }}
              />
            ) : (
              <span className="chevron-gap" />
            )}
            <ElementIcon tag={row.tag} />
            <span className="row-name">{needle && row.match ? <Marked text={row.name} needle={needle} /> : row.name}</span>
            {/* A name the page gave (data-name) hides what the element is. */}
            {row.name !== row.tag && !row.name.startsWith(`${row.tag}.`) && !row.name.startsWith(`${row.tag}#`) && (
              <span className="row-tag">{row.tag}</span>
            )}
            {row.load === "error" && row.expanded && (
              <span className="row-error" role="alert">
                Couldn't load
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    loadChildren(screenId, row.id);
                  }}
                >
                  Retry
                </button>
              </span>
            )}
            {!row.expanded && !selected.has(row.id) && holders.has(row.id) && (
              <span className="row-holds" title="Contains the selection" />
            )}
          </div>
        ))}
      </div>
      {state.truncated && <p className="panel-note">Showing the first 3,000 matches.</p>}
    </div>
  );
}

function Marked({ text, needle }: { text: string; needle: string }) {
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}

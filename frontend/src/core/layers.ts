// The layers tree: loading rows, keeping them in step with the page, search.

import { emptyLayers, ROOT, useLayers, type LayersState, type TreeNode } from "../state/layers";
import type { ChildList, Id, Ref } from "../shared/protocol";
import { getConnection } from "./connection";
import { Scope, TimedOut } from "./regions";

export const ROW_TIMEOUT = 3000;

/** Where each preview's panel was scrolled to. Not reactive: only read when
 *  the panel switches preview. */
export const scrollMemory = new Map<string, number>();

// One scope for a preview's panel (its first load, its search, its render)
// and one per row whose children are loading.
const panelScopes = new Map<string, Scope>();
const rowScopes = new Map<string, Scope>();
const searches = new Map<string, { abort: AbortController; timer: number }>();

export const layersOf = (screenId: string): LayersState => useLayers.getState()[screenId] ?? emptyLayers();

function update(screenId: string, fn: (state: LayersState) => LayersState) {
  useLayers.setState((all) => ({ [screenId]: fn(all[screenId] ?? emptyLayers()) }));
}

function patchNode(screenId: string, id: Id, patch: Partial<TreeNode>) {
  update(screenId, (s) => (s.nodes[id] ? { ...s, nodes: { ...s.nodes, [id]: { ...s.nodes[id], ...patch } } } : s));
}

export function panelScope(screenId: string): Scope {
  let scope = panelScopes.get(screenId);
  if (!scope?.open) {
    scope = new Scope({ region: "layers", screenId }, (error) => {
      update(screenId, (s) => ({
        ...s,
        error: error.message,
        errorWasTimeout: error instanceof TimedOut,
        searching: false,
        nodes: { ...s.nodes, [ROOT]: { ...s.nodes[ROOT], load: "idle" } },
      }));
    });
    panelScopes.set(screenId, scope);
  }
  return scope;
}

export function ensureRoot(screenId: string) {
  const state = layersOf(screenId);
  const root = state.nodes[ROOT];
  if (state.error || root.children || root.load === "loading") return;
  loadChildren(screenId, ROOT);
}

/**
 * Loads one row's children. A row has at most one load in flight, and the
 * answer replaces the row's child list wholesale, so collapsing, re-expanding
 * or retrying can neither duplicate nor drop children.
 */
export function loadChildren(screenId: string, id: Id) {
  const connection = getConnection(screenId);
  const node = layersOf(screenId).nodes[id];
  if (!connection?.doc || !node || node.load === "loading") return;

  const key = `${screenId}:${id}`;
  let scope: Scope;
  if (id === ROOT) {
    scope = panelScope(screenId);
  } else {
    scope = new Scope({ region: "layers-row", screenId }, () => patchNode(screenId, id, { load: "error" }));
    rowScopes.get(key)?.close();
    rowScopes.set(key, scope);
  }

  patchNode(screenId, id, { load: "loading" });
  scope.run(async () => {
    const children = await connection.request(
      "children",
      { id: id === ROOT ? null : id },
      { timeout: ROW_TIMEOUT, signal: scope.signal },
    );
    applyLists(screenId, [{ parent: id === ROOT ? null : id, children }]);
    if (id !== ROOT) {
      scope.close();
      rowScopes.delete(key);
    }
  });
}

/**
 * Applies child lists from the agent: the answer to a load, or a push after
 * the page changed its DOM. Rows are keyed by element id, and ids survive a
 * rebuild, so a row that still exists keeps its expanded state.
 */
export function applyLists(screenId: string, lists: ChildList[]) {
  const removed: Id[] = [];
  update(screenId, (state) => {
    const nodes = { ...state.nodes };
    for (const { parent, children } of lists) {
      const pid = parent ?? ROOT;
      const p = nodes[pid];
      if (!p) continue;
      nodes[pid] = {
        ...p,
        load: "idle",
        children: children.map((c) => c.id),
        hasChildren: pid === ROOT || children.length > 0,
      };
      for (const c of children) {
        const known = nodes[c.id];
        nodes[c.id] = known
          ? { ...known, name: c.name, tag: c.tag, hasChildren: c.hasChildren, parent: pid }
          : { id: c.id, name: c.name, tag: c.tag, hasChildren: c.hasChildren, parent: pid, load: "idle" };
      }
    }

    // Drop every row that is no longer reachable from the top.
    const reachable = new Set<Id>();
    const walk = (id: Id) => {
      if (reachable.has(id) || !nodes[id]) return;
      reachable.add(id);
      nodes[id].children?.forEach(walk);
    };
    walk(ROOT);
    const expanded = { ...state.expanded };
    for (const key of Object.keys(nodes)) {
      const id = Number(key);
      if (reachable.has(id)) continue;
      delete nodes[id];
      delete expanded[id];
      removed.push(id);
    }
    return { ...state, nodes, expanded };
  });

  for (const id of removed) {
    const key = `${screenId}:${id}`;
    rowScopes.get(key)?.close();
    rowScopes.delete(key);
  }
  loadExpanded(screenId);
}

/** Any row that is expanded but has never been listed gets loaded. This is
 *  what walks a deep reveal down one level at a time. */
function loadExpanded(screenId: string) {
  const state = layersOf(screenId);
  if (state.results) return;
  for (const key of Object.keys(state.expanded)) {
    const node = state.nodes[Number(key)];
    if (node && node.hasChildren && !node.children && node.load === "idle") loadChildren(screenId, node.id);
  }
}

export function toggleRow(screenId: string, id: Id) {
  update(screenId, (s) => {
    const expanded = { ...s.expanded };
    if (expanded[id]) delete expanded[id];
    else expanded[id] = true;
    return { ...s, expanded };
  });
  loadExpanded(screenId);
}

export function setExpanded(screenId: string, id: Id, open: boolean) {
  if (!!layersOf(screenId).expanded[id] !== open) toggleRow(screenId, id);
}

/** Opens every ancestor of an element and asks the panel to scroll to it. */
export function revealInPanel(screenId: string, ref: Ref) {
  update(screenId, (s) => {
    // While searching, the expanded state is frozen so that clearing the
    // search restores exactly what was there before it.
    if (s.query.trim()) return { ...s, reveal: ref.id };
    const expanded = { ...s.expanded };
    for (const id of ref.ancestors) expanded[id] = true;
    return { ...s, expanded, reveal: ref.id };
  });
  ensureRoot(screenId);
  loadExpanded(screenId);
}

export function clearReveal(screenId: string) {
  if (layersOf(screenId).reveal !== null) update(screenId, (s) => ({ ...s, reveal: null }));
}

/** An element's ancestors as the panel currently knows them. */
export function ancestorsOf(screenId: string, id: Id): Id[] {
  const state = layersOf(screenId);
  const parentOf = state.results
    ? new Map(state.results.map((r) => [r.id, r.parent ?? ROOT]))
    : { get: (x: Id) => state.nodes[x]?.parent };
  const chain: Id[] = [];
  for (let p = parentOf.get(id); p !== undefined && p > ROOT; p = parentOf.get(p)) chain.unshift(p);
  return chain;
}

// ── Search ────────────────────────────────────────────────────────────────

export function setQuery(screenId: string, query: string) {
  const active = query.trim() !== "";
  update(screenId, (s) => ({
    ...s,
    query,
    searching: active,
    results: active ? s.results : null,
    truncated: active && s.truncated,
  }));
  scheduleSearch(screenId, 150);
}

/** The page changed while a search is showing. */
export function onDirty(screenId: string) {
  if (layersOf(screenId).query.trim()) scheduleSearch(screenId, 250);
}

function scheduleSearch(screenId: string, delay: number) {
  // A newer search replaces the one in flight. That is the user moving on,
  // so the old one is cancelled rather than left to time out.
  const previous = searches.get(screenId);
  previous?.abort.abort();
  clearTimeout(previous?.timer);

  const abort = new AbortController();
  const timer = window.setTimeout(() => {
    const connection = getConnection(screenId);
    const scope = panelScope(screenId);
    if (!connection?.doc) return;
    scope.run(async () => {
      const query = layersOf(screenId).query;
      const found = await connection.request(
        "search",
        { query },
        { timeout: ROW_TIMEOUT, signal: AbortSignal.any([abort.signal, scope.signal]) },
      );
      update(screenId, (s) =>
        s.query.trim()
          ? { ...s, results: found.rows, truncated: found.truncated, searching: false }
          : { ...s, results: null, truncated: false, searching: false },
      );
      if (!query.trim()) loadExpanded(screenId);
    });
  }, delay);
  searches.set(screenId, { abort, timer });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

export function retryPanel(screenId: string) {
  panelScopes.get(screenId)?.close();
  panelScopes.delete(screenId);
  update(screenId, (s) => ({ ...s, error: null }));
  ensureRoot(screenId);
  if (layersOf(screenId).query.trim()) scheduleSearch(screenId, 0);
}

/** Forgets everything about a preview's tree: its page navigated or the
 *  preview is gone. Loads in flight are closed, not failed. */
export function resetLayers(screenId: string) {
  panelScopes.get(screenId)?.close();
  panelScopes.delete(screenId);
  for (const [key, scope] of rowScopes) {
    if (key.startsWith(`${screenId}:`)) {
      scope.close();
      rowScopes.delete(key);
    }
  }
  const search = searches.get(screenId);
  search?.abort.abort();
  clearTimeout(search?.timer);
  searches.delete(screenId);
  scrollMemory.delete(screenId);
  if (screenId in useLayers.getState()) {
    const { [screenId]: _, ...rest } = useLayers.getState();
    useLayers.setState(rest, true);
  }
}

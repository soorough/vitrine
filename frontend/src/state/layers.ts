// The layers tree of each preview: the rows the agent has listed, plus what
// the user did with them (expanded rows, search text). Kept per preview so
// switching the active preview and back finds everything as it was left.
// Written only by core/layers.ts.

import { create } from "zustand";
import type { Id, SearchRow } from "../shared/protocol";

export const ROOT: Id = 0;

export interface TreeNode {
  id: Id;
  name: string;
  tag: string;
  parent: Id;
  hasChildren: boolean;
  /** Undefined until the row has been expanded once. */
  children?: Id[];
  load: "idle" | "loading" | "error";
}

export interface LayersState {
  nodes: Record<Id, TreeNode>;
  expanded: Record<Id, true>;
  /** A row the panel should scroll to as soon as it is visible. */
  reveal: Id | null;
  query: string;
  results: SearchRow[] | null;
  truncated: boolean;
  searching: boolean;
  error: string | null;
  /** The page did not answer in time, as opposed to the panel itself failing. */
  errorWasTimeout: boolean;
}

export const emptyLayers = (): LayersState => ({
  nodes: { [ROOT]: { id: ROOT, name: "body", tag: "body", parent: -1, hasChildren: true, load: "idle" } },
  expanded: {},
  reveal: null,
  query: "",
  results: null,
  truncated: false,
  searching: false,
  error: null,
  errorWasTimeout: false,
});

export const useLayers = create<Record<string, LayersState>>(() => ({}));

export interface Row {
  id: Id;
  depth: number;
  name: string;
  tag: string;
  hasChildren: boolean;
  expanded: boolean;
  load: TreeNode["load"];
  /** Search only: false for a row shown because a descendant matches. */
  match: boolean;
}

/** The rows on screen, top to bottom. */
export function buildRows(state: LayersState): Row[] {
  if (state.results) {
    return state.results.map((r) => ({
      id: r.id,
      depth: r.depth,
      name: r.name,
      tag: r.tag,
      hasChildren: r.hasChildren,
      expanded: false,
      load: "idle",
      match: r.match,
    }));
  }
  const rows: Row[] = [];
  const walk = (ids: Id[] | undefined, depth: number) => {
    for (const id of ids ?? []) {
      const node = state.nodes[id];
      if (!node) continue;
      const expanded = !!state.expanded[id] && node.hasChildren;
      rows.push({ id, depth, name: node.name, tag: node.tag, hasChildren: node.hasChildren, expanded, load: node.load, match: true });
      if (expanded) walk(node.children, depth + 1);
    }
  };
  walk(state.nodes[ROOT]?.children, 0);
  return rows;
}

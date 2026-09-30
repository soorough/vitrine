// Element identity.
//
// An id belongs to a DOM node for as long as that node is in the document.
// When a page throws its nodes away and builds new ones (innerHTML, a naive
// re-render), the ids of the removed nodes are re-bound to the new nodes that
// stand for the same thing, or retired if nothing does.
//
// Evidence, strongest first:
//   1. the same node object            (it was only moved)
//   2. the same data-key               (the page told us what it is)
//   3. the same id attribute
//   4. content similarity, aligned in order against the siblings around it
//   5. being the only element of its kind inside a parent that was itself
//      rebuilt and matched
//
// When the evidence cannot tell two candidates apart, the id is retired. The
// rule is that a selection may be lost, but it must not move to another
// element.

import type { Id } from "../shared/protocol";

interface Print {
  bag: Map<string, number>;
  size: number;
  shape: string;
  exact: string;
}

const MAX_TOKENS = 150;
const MIN_SIMILARITY = 0.5;
const MAX_CELLS = 160_000;

/** What an element says: its words and attribute values. Classes and tags go
 *  into `shape` instead, because every item of a template shares them. */
export function print(el: Element): Print {
  const bag = new Map<string, number>();
  const shape: string[] = [];
  let size = 0;
  let budget = MAX_TOKENS;
  const add = (token: string) => {
    if (budget-- <= 0) return;
    bag.set(token, (bag.get(token) ?? 0) + 1);
    size++;
  };
  const walk = (node: Element, depth: number) => {
    if (budget <= 0) return;
    shape.push(`${depth}${node.localName}.${node.getAttribute("class") ?? ""}`);
    for (const attr of node.attributes) {
      if (attr.name === "class" || attr.name === "id" || attr.name === "data-key") continue;
      add(`@${attr.name}=${attr.value.slice(0, 80)}`);
    }
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) {
        for (const word of (c.nodeValue ?? "").split(/\s+/)) if (word) add(word);
      } else if (c.nodeType === 1) {
        walk(c as Element, depth + 1);
      }
    }
  };
  walk(el, 0);
  const shapeKey = shape.join("|");
  const exact =
    shapeKey +
    "\u0001" +
    [...bag]
      .map(([k, n]) => `${k}*${n}`)
      .sort()
      .join("\u0001");
  return { bag, size, shape: shapeKey, exact };
}

/** Dice coefficient over the two bags. Elements with nothing to say are the
 *  same only if they are built the same. */
export function similarity(a: Print, b: Print): number {
  if (a.size === 0 && b.size === 0) return a.shape === b.shape ? 1 : 0;
  let shared = 0;
  for (const [token, n] of a.bag) {
    const k = b.bag.get(token);
    if (k) shared += Math.min(n, k);
  }
  return (2 * shared) / (a.size + b.size);
}

const keyOf = (el: Element) => el.getAttribute("data-key");
const roleOf = (el: Element) => `${el.localName}.${el.getAttribute("class") ?? ""}`;

/**
 * Pairs the children a parent had with the children it has now.
 * `fresh` says whether a node was created by this batch of mutations: only
 * fresh nodes can take over an identity. `rebuilt` is true when the parent
 * itself is a replacement, which allows rule 5.
 */
export function align(
  before: Element[],
  after: Element[],
  fresh: (el: Element) => boolean,
  rebuilt: boolean,
): Map<Element, Element> {
  const out = new Map<Element, Element>();
  const n = before.length;
  const m = after.length;
  if (!n || !m) return out;

  const prints = new Map<Element, Print>();
  const printOf = (el: Element) => {
    let p = prints.get(el);
    if (!p) prints.set(el, (p = print(el)));
    return p;
  };

  const orphan = before.map((el) => !el.isConnected);
  const open = after.map(fresh);
  const plain = (el: Element) => keyOf(el) === null && !el.id;

  const count = (list: Element[], ok: boolean[]) => {
    const roles = new Map<string, number>();
    list.forEach((el, i) => {
      if (ok[i] && plain(el)) roles.set(roleOf(el), (roles.get(roleOf(el)) ?? 0) + 1);
    });
    return roles;
  };
  const rolesBefore = rebuilt ? count(before, orphan) : null;
  const rolesAfter = rebuilt ? count(after, open) : null;

  const pair = (i: number, j: number): number => {
    const a = before[i];
    const b = after[j];
    if (a === b) return 100;
    if (!orphan[i] || !open[j] || a.localName !== b.localName) return 0;
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka !== null || kb !== null) return ka === kb ? 10 : 0;
    if (a.id || b.id) return a.id === b.id ? 5 : 0;
    const s = similarity(printOf(a), printOf(b));
    if (s >= MIN_SIMILARITY) return s;
    const role = roleOf(a);
    if (rolesBefore && role === roleOf(b) && rolesBefore.get(role) === 1 && rolesAfter!.get(role) === 1) {
      return MIN_SIMILARITY;
    }
    return 0;
  };

  // Too large to align cell by cell: fall back to what needs no alignment.
  if (n * m > MAX_CELLS) {
    const index = new Map<string, Element[]>();
    after.forEach((b, j) => {
      const k = keyOf(b);
      if (open[j] && k !== null) index.set(k, [...(index.get(k) ?? []), b]);
    });
    const live = new Set(after);
    before.forEach((a, i) => {
      if (!orphan[i]) {
        if (live.has(a)) out.set(a, a);
        return;
      }
      const k = keyOf(a);
      const hits = k === null ? undefined : index.get(k);
      if (hits?.length === 1 && hits[0].localName === a.localName) out.set(a, hits[0]);
    });
    return out;
  }

  // Order-preserving alignment that maximises total evidence.
  const scores = new Float32Array(n * m);
  const width = m + 1;
  const best = new Float64Array((n + 1) * width);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = (scores[(i - 1) * m + (j - 1)] = pair(i - 1, j - 1));
      let v = Math.max(best[(i - 1) * width + j], best[i * width + j - 1]);
      if (s > 0) v = Math.max(v, best[(i - 1) * width + j - 1] + s);
      best[i * width + j] = v;
    }
  }

  const pairs: Array<[number, number]> = [];
  for (let i = n, j = m; i > 0 && j > 0; ) {
    const s = scores[(i - 1) * m + (j - 1)];
    if (s > 0 && best[i * width + j] === best[(i - 1) * width + j - 1] + s) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (best[(i - 1) * width + j] >= best[i * width + j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  for (const [i, j] of pairs) {
    const a = before[i];
    const b = after[j];
    if (a === b) {
      out.set(a, b);
      continue;
    }
    // Could another new node claim this identity just as well? Then the match
    // only stands if there are exactly as many look-alikes before as after,
    // which leaves pairing them in order as the single consistent reading.
    const s = scores[i * m + j];
    let rivals = 0;
    for (let j2 = 0; j2 < m; j2++) if (scores[i * m + j2] >= s - 1e-6 && scores[i * m + j2] < 100) rivals++;
    if (rivals > 1) {
      let twins = 0;
      const ka = keyOf(a);
      for (let i2 = 0; i2 < n; i2++) {
        const other = before[i2];
        if (!orphan[i2] || other.localName !== a.localName) continue;
        if (ka !== null) twins += keyOf(other) === ka ? 1 : 0;
        else if (a.id) twins += other.id === a.id ? 1 : 0;
        else if (plain(other)) twins += printOf(other).exact === printOf(a).exact ? 1 : 0;
      }
      if (twins !== rivals) continue;
    }
    out.set(a, b);
  }
  return out;
}

/** The element children `parent` had before `records` were applied. */
export function childrenBefore(parent: Node, records: MutationRecord[]): Element[] {
  const list: Node[] = Array.from(parent.childNodes);
  for (let k = records.length - 1; k >= 0; k--) {
    const r = records[k];
    if (r.type !== "childList" || r.target !== parent) continue;
    for (const added of r.addedNodes) {
      const at = list.indexOf(added);
      if (at >= 0) list.splice(at, 1);
    }
    let at = r.previousSibling ? list.indexOf(r.previousSibling) + 1 : 0;
    if (r.previousSibling && at === 0) at = r.nextSibling ? Math.max(0, list.indexOf(r.nextSibling)) : list.length;
    list.splice(at, 0, ...r.removedNodes);
  }
  return list.filter((node): node is Element => node.nodeType === 1);
}

export class Registry {
  private next = 1;
  private ids = new WeakMap<Element, Id>();
  private els = new Map<Id, Element>();

  idFor(el: Element): Id {
    let id = this.ids.get(el);
    if (id === undefined) {
      id = this.next++;
      this.ids.set(el, id);
      this.els.set(id, el);
    }
    return id;
  }

  peek(el: Element): Id | undefined {
    return this.ids.get(el);
  }

  get(id: Id): Element | null {
    const el = this.els.get(id);
    return el?.isConnected ? el : null;
  }

  /** Run on every mutation batch. Re-binds ids whose nodes were replaced and
   *  retires the rest. */
  reconcile(records: MutationRecord[]): { dead: Id[]; rebound: Element[] } {
    const dead: Id[] = [];
    const rebound: Element[] = [];
    if (!records.some((r) => r.type === "childList" && r.removedNodes.length)) return { dead, rebound };

    const orphans: Array<[Id, Element]> = [];
    for (const entry of this.els) if (!entry[1].isConnected) orphans.push(entry);
    if (!orphans.length) return { dead, rebound };

    const rematch = new Rematch(records);
    const taken = new Set<Element>();
    for (const [id, el] of orphans) {
      const next = rematch.resolve(el);
      this.ids.delete(el);
      if (next && !taken.has(next) && this.ids.get(next) === undefined) {
        taken.add(next);
        this.ids.set(next, id);
        this.els.set(id, next);
        rebound.push(next);
      } else {
        this.els.delete(id);
        dead.push(id);
      }
    }
    return { dead, rebound };
  }
}

class Rematch {
  private removedFrom = new Map<Node, Node>();
  private added = new Set<Node>();
  private resolved = new Map<Element, Element | null>();
  private alignments = new Map<Node, Map<Element, Element>>();
  private handedOut = new Set<Element>();
  private freshness = new Map<Element, boolean>();

  constructor(private records: MutationRecord[]) {
    for (const r of records) {
      if (r.type !== "childList") continue;
      for (const node of r.removedNodes) this.removedFrom.set(node, r.target);
      for (const node of r.addedNodes) this.added.add(node);
    }
  }

  private fresh = (el: Element): boolean => {
    let known = this.freshness.get(el);
    if (known === undefined) {
      known = false;
      for (let n: Node | null = el; n; n = n.parentNode) {
        if (this.added.has(n)) {
          known = true;
          break;
        }
      }
      this.freshness.set(el, known);
    }
    return known;
  };

  resolve(el: Element): Element | null {
    if (el.isConnected) return el;
    if (this.resolved.has(el)) return this.resolved.get(el)!;
    this.resolved.set(el, null);

    let hit: Element | null = null;
    const oldParent = el.parentNode ?? this.removedFrom.get(el);
    if (oldParent && oldParent.nodeType === 1) {
      const newParent = this.resolve(oldParent as Element);
      if (newParent) hit = this.alignment(oldParent as Element, newParent).get(el) ?? null;
    }
    // A keyed or id'd element that moved out of order, or somewhere alignment
    // does not look: its key or id is proof enough when exactly one fresh
    // element carries it.
    if (!hit) hit = this.byKey(el);

    this.resolved.set(el, hit);
    if (hit) this.handedOut.add(hit);
    return hit;
  }

  private alignment(oldParent: Element, newParent: Element): Map<Element, Element> {
    let map = this.alignments.get(oldParent);
    if (!map) {
      map = align(
        childrenBefore(oldParent, this.records),
        Array.from(newParent.children),
        this.fresh,
        oldParent !== newParent,
      );
      this.alignments.set(oldParent, map);
      for (const target of map.values()) this.handedOut.add(target);
    }
    return map;
  }

  private byKey(el: Element): Element | null {
    const key = keyOf(el);
    const selector = key !== null ? `[data-key="${CSS.escape(key)}"]` : el.id ? `#${CSS.escape(el.id)}` : null;
    if (!selector) return null;
    const hits = Array.from(document.querySelectorAll(selector)).filter(
      (c) =>
        c.localName === el.localName &&
        // An id match must not be something the page keyed differently.
        (key !== null || keyOf(c) === null) &&
        this.fresh(c) &&
        !this.handedOut.has(c),
    );
    return hits.length === 1 ? hits[0] : null;
  }

}

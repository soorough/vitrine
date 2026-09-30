// The contract between the host app and the agent script inside each page.
// Both sides import this file, so a message that does not type-check here
// cannot be sent.

export const TAG = "figr-preview";

/** An element's identity inside one document. Stable across DOM rebuilds. */
export type Id = number;
export type Mode = "select" | "interact";

/** An element plus its ancestor chain, outermost first (children of <body>). */
export interface Ref {
  id: Id;
  name: string;
  ancestors: Id[];
}

export interface NodeInfo {
  id: Id;
  name: string;
  tag: string;
  hasChildren: boolean;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where an element is, in the page's viewport. `clip` is the part that is
 *  actually visible after scroll containers cut it; null when nothing is. */
export interface Geometry {
  name: string;
  box: Box;
  clip: Box | null;
}

export interface Live {
  name: string;
  tag: string;
  id: string;
  classes: string[];
  width: number;
  height: number;
  x: number;
  y: number;
  text: string;
  color: string;
  background: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  key: string | null;
  /** What would identify this element if the page rebuilt its DOM. */
  anchor: "key" | "id" | "content";
}

export interface SearchRow extends NodeInfo {
  depth: number;
  parent: Id | null;
  match: boolean;
}

export interface ChildList {
  /** null is <body>. */
  parent: Id | null;
  children: NodeInfo[];
}

export interface Requests {
  /** The element under a point, or null for page background. */
  pick: { params: { x: number; y: number }; result: Ref | null };
  /** Lists children and starts pushing `tree` updates for that parent. */
  children: { params: { id: Id | null }; result: NodeInfo[] };
  step: { params: { id: Id; dir: "parent" | "child" | "next" | "prev" }; result: Ref | null };
  search: { params: { query: string }; result: { rows: SearchRow[]; truncated: boolean } };
  /** Scrolls the page (and only the page) so the element is in view. */
  reveal: { params: { id: Id }; result: boolean };
}
export type Method = keyof Requests;

export type AgentBody =
  | { t: "hello"; url: string }
  | { t: "bye" }
  /** `hover` is present only when the element under the pointer changed. It
   *  rides with the rectangles so the host can draw both in one paint. */
  | { t: "geometry"; items: Record<Id, Geometry>; hover?: Ref | null }
  | { t: "live"; items: Record<Id, Live> }
  | { t: "tree"; lists: ChildList[] }
  | { t: "gone"; ids: Id[] }
  | { t: "dirty" }
  | { t: "pageerror"; message: string }
  | { t: "fault"; message: string }
  | { t: "key"; key: string; shift: boolean; ctrl: boolean; meta: boolean; alt: boolean }
  | { t: "zoom"; x: number; y: number; dy: number }
  | { t: "res"; rid: number; ok: true; data: unknown }
  | { t: "res"; rid: number; ok: false; error: string };

export type HostBody =
  | { t: "init"; mode: Mode }
  | { t: "mode"; mode: Mode }
  | { t: "pointer"; at: { x: number; y: number } | null }
  | { t: "scroll"; x: number; y: number; dx: number; dy: number }
  | { t: "track"; selected: Id[]; hover: Id | null }
  | { t: "req"; rid: number; method: Method; params: unknown }
  | { t: "debug"; action: "throw" };

/** Every message names the document it belongs to. A page that navigates is a
 *  new document with a new `doc`, so anything addressed to or sent by the old
 *  one is dropped on arrival. */
export type Envelope<B> = B & { figr: typeof TAG; doc: string };
export type AgentMsg = Envelope<AgentBody>;
export type HostMsg = Envelope<HostBody>;

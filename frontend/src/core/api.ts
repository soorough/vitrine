import { setApiKnob, useChaos } from "./chaos";

const API = "http://localhost:4000";

export interface Screen {
  id: string;
  name: string;
  url: string;
}

export interface Details {
  component: string;
  description: string;
  status: string;
  owner: string;
}

const NOT_FOUND = Symbol("not found");

async function get(path: string, route: "screens" | "details", signal: AbortSignal): Promise<unknown> {
  const knob = useChaos.getState().api[route];
  const url = new URL(API + path);
  if (knob.latency) url.searchParams.set("latency", String(knob.latency));
  const fail = knob.failNext ? 1 : knob.fail;
  if (fail) url.searchParams.set("fail", String(fail));

  const res = await fetch(url, { signal });
  // Spent only by a request that ran to the end, not by one that was aborted.
  if (knob.failNext) setApiKnob(route, { failNext: false });
  if (res.status === 404) return NOT_FOUND;
  if (!res.ok) throw new Error(`The server answered ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // A failed request can also be a 200 with a body cut short.
    throw new Error("The server sent a response that could not be read");
  }
}

const isText = (v: unknown): v is string => typeof v === "string";

export async function getScreens(signal: AbortSignal): Promise<Screen[]> {
  const data = await get("/screens", "screens", signal);
  const ok =
    Array.isArray(data) &&
    data.every((s) => s && isText(s.id) && isText(s.name) && isText(s.url) && URL.canParse(s.url));
  if (!ok) throw new Error("The list of screens is not in the expected shape");
  return data as Screen[];
}

// Details change rarely and the same element is selected again and again,
// often on several screens that show the same page. Answers are kept for a
// few minutes; failures are never kept, so Retry always asks again.
const DETAILS_TTL = 5 * 60_000;
const detailsCache = new Map<string, { value: Details | null; at: number }>();

/** While the dev menu is slowing or failing requests, the cache stays out of
 *  the way so the failure can be seen. */
const testingDetails = () => {
  const { api, armed } = useChaos.getState();
  const knob = api.details;
  return knob.failNext || knob.fail > 0 || knob.latency > 0 || !!armed["details-response"];
};

/** A cached answer, if there is a fresh one. Lets the inspector show details
 *  in the same frame as the selection instead of after a loading state. */
export function cachedDetails(key: string): { value: Details | null } | undefined {
  const hit = detailsCache.get(key);
  if (!hit || testingDetails() || Date.now() - hit.at > DETAILS_TTL) return undefined;
  return { value: hit.value };
}

/** Null means the API has no details for this key, which is not an error. */
export async function getDetails(key: string, signal: AbortSignal): Promise<Details | null> {
  const cached = cachedDetails(key);
  if (cached) return cached.value;
  const data = await get(`/elements/${encodeURIComponent(key)}`, "details", signal);
  let value: Details | null = null;
  if (data !== NOT_FOUND) {
    const d = data as Partial<Details> | null;
    if (!d || !isText(d.component) || !isText(d.description) || !isText(d.status) || !isText(d.owner)) {
      throw new Error("The element details are not in the expected shape");
    }
    value = { component: d.component, description: d.description, status: d.status, owner: d.owner };
  }
  detailsCache.set(key, { value, at: Date.now() });
  return value;
}

// Selection intent under slow and out-of-order answers from a page. The page
// is a fake connection whose answers each test releases by hand.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ref } from "../shared/protocol";

const { reports, connection } = vi.hoisted(() => ({
  reports: [] as unknown[],
  connection: { current: null as unknown },
}));

vi.mock("../../report.js", () => ({ report: (error: unknown) => reports.push(error) }));
vi.mock("./connection", () => ({
  getConnection: () => connection.current,
  allConnections: () => (connection.current ? [connection.current] : []),
}));

import { useCamera } from "../state/camera";
import { useSession, initialSession } from "../state/session";
import { clearSelection, pickAt } from "./commands";
import { Cancelled, Scope, TimedOut } from "./regions";

interface Pending {
  method: string;
  signal?: AbortSignal;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

function fakeConnection() {
  const pending: Pending[] = [];
  const scope = new Scope({ region: "preview", screenId: "s1" }, () => {});
  const fake = {
    screen: { id: "s1" },
    doc: "doc-1",
    tracked: "",
    scope,
    send: vi.fn(),
    request: (method: string, _params: unknown, options: { signal?: AbortSignal }) => {
      // Tree loads triggered by a selection answer at once with no rows.
      if (method !== "pick") return Promise.resolve([]);
      return new Promise((resolve, reject) => {
        const p: Pending = { method, signal: options.signal, resolve, reject };
        options.signal?.addEventListener("abort", () => reject(new Cancelled()));
        pending.push(p);
      });
    },
  };
  return { fake, pending, scope };
}

const ref = (id: number): Ref => ({ id, name: `el-${id}`, ancestors: [] });
const settle = () => new Promise((r) => setTimeout(r, 0));
const selectedIds = () => useSession.getState().selection?.items.map((i) => i.id) ?? [];

let page: ReturnType<typeof fakeConnection>;

beforeEach(() => {
  reports.length = 0;
  useSession.setState({ ...initialSession });
  page = fakeConnection();
  connection.current = page.fake;
});

describe("a click's answer never overrides newer intent", () => {
  it("Escape while a click is waiting: the late answer does not bring the selection back", async () => {
    pickAt("s1", 10, 10, false);
    clearSelection();
    page.pending[0].resolve(ref(1));
    await settle();
    expect(selectedIds()).toEqual([]);
    expect(page.pending[0].signal?.aborted).toBe(true);
    expect(reports).toHaveLength(0);
  });

  it("two overlapping Shift+clicks both land, in the order they were made", async () => {
    pickAt("s1", 10, 10, true);
    pickAt("s1", 20, 20, true);
    // The second click is answered first.
    page.pending[1].resolve(ref(2));
    page.pending[0].resolve(ref(1));
    await settle();
    expect(selectedIds()).toEqual([1, 2]);
  });

  it("a newer click cancels the older one, so the older one cannot time out and fail the preview", async () => {
    pickAt("s1", 10, 10, false);
    pickAt("s1", 20, 20, false);
    expect(page.pending[0].signal?.aborted).toBe(true);
    page.pending[1].resolve(ref(2));
    await settle();
    expect(selectedIds()).toEqual([2]);
    expect(page.scope.open).toBe(true);
    expect(reports).toHaveLength(0);
  });

  it("a click on page background clears the selection", async () => {
    useSession.setState({ selection: { screenId: "s1", items: [ref(9)] } });
    pickAt("s1", 10, 10, false);
    page.pending[0].resolve(null);
    await settle();
    expect(selectedIds()).toEqual([]);
  });

  it("a current click the page never answers fails the preview, and is reported once", async () => {
    pickAt("s1", 10, 10, false);
    page.pending[0].reject(new TimedOut("The page did not answer within 10 seconds."));
    await settle();
    expect(page.scope.open).toBe(false);
    expect(reports).toHaveLength(1);
  });
});

describe("hover and the camera", () => {
  it("any camera move clears the pointer hover, including a keyboard zoom", () => {
    useSession.setState({ hover: { ...ref(3), screenId: "s1", source: "pointer" } });
    // Shift+1, Fit and the zoom buttons all end in a camera update like this.
    useCamera.setState({ z: useCamera.getState().z * 1.25 });
    expect(useSession.getState().hover).toBeNull();
  });

  it("a hover from the layers panel is not the pointer's, so it stays", () => {
    useSession.setState({ hover: { ...ref(3), screenId: "s1", source: "panel" } });
    useCamera.setState({ x: useCamera.getState().x + 10 });
    expect(useSession.getState().hover?.id).toBe(3);
  });
});

describe("Scope", () => {
  it("reports a failure once, however many times it is failed", () => {
    const failures: Error[] = [];
    const scope = new Scope({ region: "details", screenId: "s1" }, (e) => failures.push(e));
    scope.fail(new Error("first"));
    scope.fail(new Error("second"));
    expect(reports).toHaveLength(1);
    expect(failures.map((e) => e.message)).toEqual(["first"]);
  });

  it("treats cancellation as not a failure", () => {
    const scope = new Scope({ region: "details", screenId: "s1" }, () => {});
    scope.fail(new Cancelled());
    scope.fail(new DOMException("aborted", "AbortError"));
    expect(reports).toHaveLength(0);
    expect(scope.open).toBe(true);
  });

  it("ignores anything that arrives after it is closed", () => {
    const scope = new Scope({ region: "details", screenId: "s1" }, () => {});
    scope.close();
    scope.fail(new Error("late"));
    expect(scope.run(() => "ran")).toBeUndefined();
    expect(reports).toHaveLength(0);
  });

  it("catches a throw inside run, and a rejection from the promise it returns", async () => {
    const a = new Scope({ region: "details", screenId: "s1" }, () => {});
    a.run(() => {
      throw new Error("sync");
    });
    const b = new Scope({ region: "details", screenId: "s1" }, () => {});
    b.run(async () => {
      throw new Error("async");
    });
    await settle();
    expect(reports).toHaveLength(2);
  });
});

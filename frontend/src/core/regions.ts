// Failure containment.
//
// A Scope is one attempt at one region: one load of the board, one connection
// to a preview, one fetch of a row's children. Everything that can go wrong
// for that attempt, wherever it is thrown, is handed to scope.fail, and that
// is the only place report() is called from.
//
//   - a scope fails at most once, so a failure is reported exactly once;
//   - a retry is a new scope, so failing again is a new report;
//   - a closed scope ignores everything, so a late response or error from a
//     region that is gone changes nothing and reports nothing;
//   - cancellation is not a failure.

import { report, type ReportContext } from "../../report.js";
import { DEV, useReports } from "./chaos";

export class Cancelled extends Error {
  constructor() {
    super("Cancelled");
    this.name = "Cancelled";
  }
}

export class TimedOut extends Error {
  constructor(what: string) {
    super(what);
    this.name = "TimedOut";
  }
}

export const isCancelled = (e: unknown) =>
  e instanceof Cancelled || (e instanceof DOMException && e.name === "AbortError");

export const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

// An error object is reported once even if two scopes both see it.
const reported = new WeakSet<Error>();

export class Scope {
  private controller = new AbortController();
  private state: "open" | "failed" | "closed" = "open";

  constructor(
    readonly context: ReportContext,
    private onFail: (error: Error) => void,
  ) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get open(): boolean {
    return this.state === "open";
  }

  fail = (raw: unknown): void => {
    if (this.state !== "open" || isCancelled(raw)) return;
    const error = toError(raw);
    this.state = "failed";
    this.controller.abort();
    if (!reported.has(error)) {
      reported.add(error);
      report(error, this.context);
      if (DEV) useReports.setState((s) => ({ entries: [...s.entries, { ...this.context, message: error.message }].slice(-50) }));
    }
    this.onFail(error);
  };

  /** Runs `fn` for this region. A throw, or a rejection if it returns a
   *  promise, fails the region. Does nothing once the scope is over. */
  run<T>(fn: () => T): T | undefined {
    if (this.state !== "open") return undefined;
    try {
      const out = fn();
      if (out instanceof Promise) out.catch(this.fail);
      return out;
    } catch (e) {
      this.fail(e);
      return undefined;
    }
  }

  /** Wraps an event handler or callback so it runs through `run`. */
  bind<A extends unknown[]>(fn: (...args: A) => unknown): (...args: A) => void {
    return (...args) => {
      this.run(() => fn(...args));
    };
  }

  close(): void {
    if (this.state === "open") this.state = "closed";
    this.controller.abort();
  }
}

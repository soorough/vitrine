// One PreviewConnection per attempt at one preview. It owns the channel to
// that iframe's agent: the handshake, the requests in flight, and the rule
// for what to do when the page on the other end is slow, gone or replaced.

import { patchPreview, useBoard } from "../state/board";
import { isFrameVisible, zoomToFrame } from "../state/camera";
import { showToast } from "../state/toasts";
import { useGeometry, useLive } from "../state/page";
import { useSession } from "../state/session";
import {
  TAG,
  type AgentMsg,
  type HostBody,
  type Method,
  type Requests,
} from "../shared/protocol";
import type { Screen } from "./api";
import { chaos, take } from "./chaos";
import { handleKey, onGone, onPointerHover, resetPage, syncTracking, zoomFromPreview } from "./commands";
import { applyLists, ensureRoot, onDirty } from "./layers";
import { Cancelled, Scope, TimedOut } from "./regions";

export const CONNECT_TIMEOUT = 10_000;
const CONNECT_TITLE = "Couldn't connect to this preview";

class ConnectError extends Error {}

interface Pending {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: number;
}

const connections = new Map<string, PreviewConnection>();
export const getConnection = (screenId: string) => connections.get(screenId);
export const allConnections = () => connections.values();

// One listener for every preview. A message is routed by the window it came
// from, which the sender cannot fake.
window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as AgentMsg | null;
  if (!msg || msg.figr !== TAG) return;
  for (const connection of connections.values()) {
    if (connection.iframe.contentWindow === event.source) {
      connection.receive(event.origin, msg);
      return;
    }
  }
});

export class PreviewConnection {
  /** The document currently on the other end, or null while there is none. */
  doc: string | null = null;
  readonly scope: Scope;
  /** The last `track` message sent, to avoid repeating it. */
  tracked = "";
  /** A page has said hello at least once on this attempt. */
  private everConnected = false;

  private origin: string;
  private pending = new Map<number, Pending>();
  private nextRid = 1;
  private helloTimer = 0;

  constructor(
    readonly screen: Screen,
    readonly iframe: HTMLIFrameElement,
    src: string,
    private muted: boolean,
  ) {
    this.origin = new URL(src).origin;
    this.scope = new Scope({ region: "preview", screenId: screen.id }, (error) => {
      this.cancelAll();
      clearTimeout(this.helloTimer);
      this.doc = null;
      resetPage(screen.id);
      const loaded = this.everConnected;
      patchPreview(screen.id, {
        status: "error",
        error:
          error instanceof ConnectError
            ? { title: CONNECT_TITLE, message: error.message, soft: false }
            : {
                title: "This preview stopped working",
                message: "Retry reloads only this preview. The rest of the board is unaffected.",
                detail: error.message,
                soft: loaded,
              },
      });
      // A preview failing off screen changes nothing the user can see, so
      // point them at it. The error itself stays on the preview.
      const index = useBoard.getState().screens.findIndex((s) => s.id === screen.id);
      if (index >= 0 && !isFrameVisible(index)) {
        showToast({
          text: `${screen.name}: ${error instanceof ConnectError ? CONNECT_TITLE.toLowerCase() : "stopped working"}`,
          action: { label: "Show", run: () => zoomToFrame(index) },
        });
      }
    });
    connections.set(screen.id, this);
    this.awaitHello();

    // The iframe cannot tell us that its page failed to load, so ask the
    // server directly. A page that is missing fails now instead of in 10s.
    fetch(src, { signal: this.scope.signal, cache: "no-store" }).then(
      (res) => {
        if (!res.ok && !this.doc) this.scope.fail(new ConnectError(
            res.status === 404
              ? "The page was not found on the server (404)."
              : `The page server answered with an error (${res.status}).`,
          ));
      },
      (error) => {
        if (!this.doc) this.scope.fail(error instanceof DOMException ? error : new ConnectError("The page server could not be reached. Check that the backend is running."));
      },
    );
  }

  private awaitHello() {
    clearTimeout(this.helloTimer);
    this.helloTimer = window.setTimeout(
      this.scope.bind(() => {
        throw new ConnectError("The page loaded, but its script did not answer within 10 seconds.");
      }),
      CONNECT_TIMEOUT,
    );
  }

  receive(origin: string, msg: AgentMsg) {
    if (origin !== this.origin) return;
    this.scope.run(() => {
      if (msg.t === "hello") {
        if (!this.muted) this.onHello(msg.doc, msg.url);
        return;
      }
      // From a document that has since been replaced.
      if (msg.doc !== this.doc) return;
      const id = this.screen.id;
      chaos("preview-message", id);

      switch (msg.t) {
        case "bye":
          // The page is navigating. Everything known about it is now stale,
          // and the next document has 10 seconds to say hello.
          this.doc = null;
          this.cancelAll();
          resetPage(id);
          patchPreview(id, { status: "connecting" });
          this.awaitHello();
          break;
        case "geometry":
          useGeometry.setState({ [id]: msg.items });
          if (msg.hover !== undefined) onPointerHover(id, msg.hover);
          break;
        case "live":
          useLive.setState({ [id]: msg.items });
          break;
        case "tree":
          applyLists(id, msg.lists);
          break;
        case "gone":
          onGone(id, msg.ids);
          break;
        case "dirty":
          onDirty(id);
          break;
        case "pageerror": {
          const errors = useBoard.getState().previews[id]?.pageErrors ?? [];
          patchPreview(id, { pageErrors: [...errors, msg.message].slice(-20) });
          break;
        }
        case "fault":
          throw new Error(`The preview's script failed: ${msg.message}`);
        case "key":
          handleKey(msg, id);
          break;
        case "zoom":
          zoomFromPreview(id, msg.x, msg.y, msg.dy);
          break;
        case "res": {
          const pending = this.pending.get(msg.rid);
          if (!pending) return; // timed out or cancelled earlier
          this.pending.delete(msg.rid);
          clearTimeout(pending.timer);
          if (msg.ok) pending.resolve(msg.data);
          else pending.reject(new Error(msg.error));
          break;
        }
      }
    });
  }

  private onHello(doc: string, url: string) {
    if (doc !== this.doc) {
      // A new document: first load, reload, or a link that was followed.
      clearTimeout(this.helloTimer);
      this.cancelAll();
      this.doc = doc;
      this.everConnected = true;
      this.tracked = "";
      resetPage(this.screen.id);
      patchPreview(this.screen.id, { status: "ready", error: null, pageErrors: [], url });
    }
    this.send({ t: "init", mode: useSession.getState().mode });
    syncTracking();
    if (useSession.getState().activeId === this.screen.id) ensureRoot(this.screen.id);
  }

  send(body: HostBody) {
    if (!this.doc) return;
    this.iframe.contentWindow?.postMessage({ figr: TAG, doc: this.doc, ...body }, this.origin);
  }

  /**
   * Asks the agent something. Rejects with TimedOut if it does not answer in
   * time, and with Cancelled if the document goes away, the connection is
   * disposed, or `signal` aborts. Callers treat Cancelled as "never mind".
   */
  request<M extends Method>(
    method: M,
    params: Requests[M]["params"],
    options: { timeout: number; signal?: AbortSignal },
  ): Promise<Requests[M]["result"]> {
    return new Promise((resolve, reject) => {
      if (!this.doc || !this.scope.open || options.signal?.aborted) return reject(new Cancelled());
      const rid = this.nextRid++;
      const settle = () => {
        this.pending.delete(rid);
        clearTimeout(timer);
      };
      const timer = window.setTimeout(() => {
        settle();
        reject(new TimedOut(`The page did not answer within ${options.timeout / 1000} seconds.`));
      }, options.timeout);
      options.signal?.addEventListener("abort", () => {
        settle();
        reject(new Cancelled());
      });
      this.pending.set(rid, { resolve: resolve as (data: unknown) => void, reject, timer });
      // Dev menu: lose the message, as if the page never heard it.
      if (method === "children" && take("drop-children")) return;
      this.send({ t: "req", rid, method, params });
    });
  }

  private cancelAll() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Cancelled());
    }
    this.pending.clear();
  }

  dispose() {
    this.scope.close();
    this.cancelAll();
    clearTimeout(this.helloTimer);
    if (connections.get(this.screen.id) === this) connections.delete(this.screen.id);
  }
}

import { useEffect, useRef, useState } from "react";
import { cachedDetails, getDetails, type Details as DetailsData } from "../core/api";
import { chaos, disarm, isArmed, useChaos } from "../core/chaos";
import { selectRow } from "../core/commands";
import { Scope } from "../core/regions";
import { useLayers } from "../state/layers";
import { useLive } from "../state/page";
import { useSession, type Selection } from "../state/session";
import type { Live } from "../shared/protocol";
import { Boundary, RegionError } from "./Region";

/**
 * The inspector is not part of the furniture: it slides in when there is
 * something to inspect (a selection, the notice that a selection stopped
 * existing, or its own failure) and can be closed. The next selection opens
 * it again.
 */
export function Inspector() {
  const selection = useSession((s) => s.selection);
  const lost = useSession((s) => s.lost);
  const [failure, setFailure] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [closedFor, setClosedFor] = useState<unknown>(undefined);

  // What the panel is about right now. Closing it only lasts until this changes.
  const subject: unknown = selection ?? (lost ? "lost" : null);
  const open = (subject !== null || failure !== null) && closedFor !== subject;

  // While sliding out, keep showing what was there instead of going blank.
  const last = useRef<Selection | null>(null);
  if (selection) last.current = selection;
  const shown = selection ?? (lost ? null : last.current);

  return (
    <aside className={open ? "inspector open" : "inspector"} aria-hidden={!open} inert={!open}>
      <header className="inspector-head">
        <h2>Inspector</h2>
        <button type="button" className="icon-button" aria-label="Close inspector" onClick={() => setClosedFor(subject)}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4.2 3.1L8 6.9l3.8-3.8 1.1 1.1L9.1 8l3.8 3.8-1.1 1.1L8 9.1l-3.8 3.8-1.1-1.1L6.9 8 3.1 4.2z" />
          </svg>
        </button>
      </header>
      {failure ? (
        <RegionError
          title="The inspector stopped working"
          message="The selection is kept, and the board and layers still work."
          detail={failure.message}
          onRetry={() => {
            setFailure(null);
            setAttempt((n) => n + 1);
          }}
        />
      ) : (
        <Boundary
          key={attempt}
          onError={(error) => {
            disarm("inspector-render");
            const screenId = useSession.getState().selection?.screenId ?? null;
            new Scope({ region: "inspector", screenId }, setFailure).fail(error);
          }}
        >
          <Body selection={shown} current={selection !== null} />
        </Boundary>
      )}
    </aside>
  );
}

const ANCHORS: Record<Live["anchor"], { label: string; hint: string }> = {
  key: { label: "Tracked by data-key", hint: "If the page rebuilds this element, it is found again by its data-key." },
  id: { label: "Tracked by id", hint: "If the page rebuilds this element, it is found again by its id attribute." },
  content: {
    label: "Tracked by content",
    hint: "No data-key or id. If the page rebuilds this element, it is matched by its content and its neighbours, and dropped if that is ambiguous.",
  },
};

/** `current` is false while the panel slides out showing the last selection. */
function Body({ selection, current }: { selection: Selection | null; current: boolean }) {
  const live = useLive((s) => (selection ? s[selection.screenId] : undefined));
  const nodes = useLayers((s) => (selection ? s[selection.screenId]?.nodes : undefined));
  useChaos((s) => s.armed["inspector-render"]);
  if (isArmed("inspector-render")) throw new Error("Injected failure (inspector-render)");

  if (!selection) return <p className="panel-empty">This element no longer exists</p>;

  const values = selection.items.map((item) => live?.[item.id]).filter((v): v is Live => !!v);
  const ready = values.length === selection.items.length;
  const single = selection.items.length === 1;
  const item = selection.items[selection.items.length - 1];
  // The path down to the element, as far as the layers panel knows the names.
  const trail = single ? item.ancestors.filter((id) => nodes?.[id]).slice(-3) : [];

  return (
    <div className="inspector-body">
      <div className="inspector-subject">
        {trail.length > 0 && (
          <nav className="trail" aria-label="Parents">
            {trail.map((id) => (
              <button key={id} type="button" title="Select this parent" onClick={() => selectRow(selection.screenId, id, false)}>
                {nodes![id].name}
              </button>
            ))}
          </nav>
        )}
        <h3 className="inspector-title">{single ? (values[0]?.name ?? item.name) : `${selection.items.length} elements`}</h3>
        {single && ready && (
          <span className={`anchor ${values[0].anchor}`} title={ANCHORS[values[0].anchor].hint}>
            {ANCHORS[values[0].anchor].label}
          </span>
        )}
        {!single && (
          // Which elements "N elements" means; each one can be picked out alone.
          <div className="picked">
            {selection.items.map((it) => (
              <button
                key={it.id}
                type="button"
                title="Select only this one"
                onClick={() => selectRow(selection.screenId, it.id, false)}
              >
                {live?.[it.id]?.name ?? it.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <section className="section">
        <h4>Live</h4>
        <LiveFields values={ready ? values : null} />
      </section>

      {single && current && (
        <section className="section">
          <h4>Details</h4>
          {ready &&
            (values[0].key === null ? (
              <p className="quiet">No details</p>
            ) : (
              // Keyed on the element: a new selection starts from nothing, so
              // an earlier selection's details can never be on screen for it.
              <Details key={`${selection.screenId}:${values[0].key}`} screenId={selection.screenId} elementKey={values[0].key} />
            ))}
        </section>
      )}
    </div>
  );
}

const FIELDS: Array<{ label: string; read: (v: Live) => string; swatch?: boolean; mono?: boolean }> = [
  { label: "Name", read: (v) => v.name },
  { label: "Tag", read: (v) => v.tag, mono: true },
  { label: "Id", read: (v) => v.id || "None", mono: true },
  { label: "Classes", read: (v) => v.classes.join(" ") || "None", mono: true },
  { label: "Size", read: (v) => `${v.width} × ${v.height}` },
  { label: "Position", read: (v) => `${v.x}, ${v.y}` },
  { label: "Text", read: (v) => v.text || "None" },
  { label: "Text colour", read: (v) => v.color, swatch: true, mono: true },
  { label: "Background", read: (v) => v.background, swatch: true, mono: true },
  { label: "Font", read: (v) => v.fontFamily },
  { label: "Font size", read: (v) => v.fontSize },
  { label: "Font weight", read: (v) => v.fontWeight },
];

/** `values` is null for the moment between selecting and the page answering.
 *  The rows stay in place so the panel does not jump. */
function LiveFields({ values }: { values: Live[] | null }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (label: string, text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(label);
        setTimeout(() => setCopied((c) => (c === label ? null : c)), 1100);
      },
      () => undefined,
    );
  };

  return (
    <dl className="fields">
      {FIELDS.map((field) => {
        if (!values) {
          return (
            <div className="field" key={field.label}>
              <dt>{field.label}</dt>
              <dd className="pending" />
            </div>
          );
        }
        const first = field.read(values[0]);
        const mixed = values.some((v) => field.read(v) !== first);
        if (mixed) {
          return (
            <div className="field" key={field.label}>
              <dt>{field.label}</dt>
              <dd className="mixed">Mixed</dd>
            </div>
          );
        }
        // An empty value is an absence, not a value: plain, and nothing to copy.
        if (first === "None") {
          return (
            <div className="field" key={field.label}>
              <dt>{field.label}</dt>
              <dd className="none">None</dd>
            </div>
          );
        }
        return (
          <div className="field" key={field.label}>
            <dt>{field.label}</dt>
            <dd>
              <button type="button" className={field.mono ? "value code" : "value"} title="Click to copy" onClick={() => copy(field.label, first)}>
                {field.swatch && <span className="swatch" style={{ background: first }} />}
                {copied === field.label ? "Copied" : first}
              </button>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

type DetailsState =
  | { status: "loading" }
  | { status: "ready"; data: DetailsData }
  | { status: "none" }
  | { status: "error"; message: string };

function Details({ screenId, elementKey }: { screenId: string; elementKey: string }) {
  const [state, setState] = useState<DetailsState>(() => {
    const cached = cachedDetails(elementKey);
    if (!cached) return { status: "loading" };
    return cached.value ? { status: "ready", data: cached.value } : { status: "none" };
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Already answered from the cache on first render.
    if (attempt === 0 && cachedDetails(elementKey)) return;
    // One scope per request. Unmounting (the selection moved on) closes it:
    // the fetch is aborted, and whatever it would have said is ignored.
    const scope = new Scope({ region: "details", screenId, elementKey }, (error) =>
      setState({ status: "error", message: error.message }),
    );
    scope.run(async () => {
      const data = await getDetails(elementKey, scope.signal);
      if (!scope.open) return;
      chaos("details-response");
      setState(data ? { status: "ready", data } : { status: "none" });
    });
    return () => scope.close();
  }, [screenId, elementKey, attempt]);

  if (state.status === "loading") return <p className="quiet">Loading details…</p>;
  if (state.status === "none") return <p className="quiet">No details for this element</p>;
  if (state.status === "error") {
    return (
      <RegionError
        compact
        title="Couldn't load the details"
        message="The live values above are still current."
        detail={state.message}
        onRetry={() => {
          setState({ status: "loading" });
          setAttempt((n) => n + 1);
        }}
      />
    );
  }
  const { data } = state;
  return (
    <dl className="fields">
      <div className="field">
        <dt>Component</dt>
        <dd className="code">{data.component}</dd>
      </div>
      <div className="field">
        <dt>Description</dt>
        <dd>{data.description}</dd>
      </div>
      <div className="field">
        <dt>Status</dt>
        <dd>
          <span className={`status ${data.status}`}>{data.status}</span>
        </dd>
      </div>
      <div className="field">
        <dt>Owner</dt>
        <dd>{data.owner}</dd>
      </div>
    </dl>
  );
}

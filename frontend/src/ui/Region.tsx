import { Component, useEffect, useState, type ReactNode } from "react";

/** Catches a render error and hands it to the region it belongs to. What the
 *  region shows instead is the region's business, so this renders nothing. */
export class Boundary extends Component<
  { onError: (error: Error) => void; fallback?: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}

/**
 * The one way a failed region looks. It says what happened in plain words,
 * what still works, and offers Retry. The technical reason is one click away
 * for whoever needs it. Pressing Retry shows at once that it was heard.
 */
export function RegionError(props: {
  title: string;
  message?: string;
  detail?: string;
  onRetry: () => void;
  compact?: boolean;
}) {
  const [retrying, setRetrying] = useState(false);
  const [open, setOpen] = useState(false);
  const detail = props.detail && props.detail !== props.message ? props.detail : undefined;

  // A new failure (the retry failed again) makes the button usable again.
  useEffect(() => setRetrying(false), [props.title, props.message, props.detail]);

  return (
    <div className={props.compact ? "region-error compact" : "region-error"} role="alert">
      <svg className="region-error-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 1.5a6.5 6.5 0 110 13 6.5 6.5 0 010-13zm0 3.25a.9.9 0 00-.9.95l.2 3.6a.7.7 0 001.4 0l.2-3.6a.9.9 0 00-.9-.95zm0 5.9a.85.85 0 100 1.7.85.85 0 000-1.7z" />
      </svg>
      <div className="region-error-body">
        <p className="region-error-title">{props.title}</p>
        {props.message && <p className="region-error-message">{props.message}</p>}
        {detail && open && <p className="region-error-detail">{detail}</p>}
        <div className="region-error-actions">
          <button
            type="button"
            className="button"
            disabled={retrying}
            onClick={() => {
              setRetrying(true);
              props.onRetry();
            }}
          >
            {retrying ? "Retrying…" : "Retry"}
          </button>
          {detail && (
            <button type="button" className="link-button" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? "Hide details" : "Details"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Vitrine: a pane of glass with a selection handle on its corner. You look at
// the pages through the glass and pick things out; you never reach in.
export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="6.5" fill="var(--ink)" />
      <rect x="5.5" y="5.5" width="11.5" height="11.5" rx="1.5" fill="none" stroke="var(--on-ink)" strokeWidth="1.7" />
      <path d="M8.6 13.4l4.8-4.8" stroke="var(--on-ink)" strokeOpacity="0.5" strokeWidth="1.7" strokeLinecap="round" />
      <rect x="13.6" y="13.6" width="7" height="7" rx="1.6" fill="var(--select)" stroke="var(--ink)" strokeWidth="1.6" />
    </svg>
  );
}

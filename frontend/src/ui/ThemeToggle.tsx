import { cycleTheme, useTheme, type ThemeChoice } from "../state/theme";

const ICONS: Record<ThemeChoice, { label: string; path: string }> = {
  system: { label: "Theme: follows your system", path: "M8 2.5a5.5 5.5 0 100 11zM8 2.5a5.5 5.5 0 110 11" },
  light: {
    label: "Theme: light",
    path: "M8 5.2a2.8 2.8 0 110 5.6 2.8 2.8 0 010-5.6zM8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9",
  },
  dark: { label: "Theme: dark", path: "M13 9.6A5.5 5.5 0 016.4 3a5.5 5.5 0 106.6 6.6z" },
};

export function ThemeToggle() {
  const choice = useTheme((s) => s.choice);
  const icon = ICONS[choice];
  return (
    <button type="button" className="icon-button theme-toggle" title={`${icon.label}. Click to change.`} aria-label={icon.label} onClick={cycleTheme}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d={icon.path} />
      </svg>
    </button>
  );
}

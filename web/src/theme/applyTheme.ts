import { cssVars } from "./theme.config.js";

type Mode = "light" | "dark";

/**
 * Push the theme.config.js CSS-variable values onto :root for the given mode.
 * index.css ships the same values as static defaults (so there's no FOUC), but
 * asserting them here means a future edit to theme.config.js propagates to the
 * raw-CSS utilities too — the config stays the single place to change colors.
 */
export function applyThemeVars(mode: Mode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const vars = cssVars[mode];
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
}

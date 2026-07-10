/**
 * ============================================================================
 *  gVoice AQUA THEME — single source of truth
 * ============================================================================
 *  Ported from the SecondBrain RN app (Docs/THEME_WEB_HANDOFF.md). Edit colors,
 *  radii, spacing, shadows, gradients HERE and everything downstream follows:
 *
 *    • tailwind.config.js imports `palette`/`radii`/… to build its utilities.
 *    • index.css :root mirrors `cssVars.light`; html.dark mirrors `cssVars.dark`
 *      (the var() names — --bg, --surface, --ink, --ring … — are unchanged so
 *      every existing component keeps working; only the values changed to aqua).
 *    • applyThemeVars() (theme/applyTheme.ts) re-asserts these vars at runtime
 *      so future edits here propagate without hand-touching CSS.
 *
 *  This is plain ESM JS (not TS) so tailwind.config.js can import it directly at
 *  build time. Types live in theme.config.d.ts.
 * ============================================================================
 */

// ── Brand: gVoice aqua ──────────────────────────────────────────────────────
export const aqua = {
  accent: "#06B6D4", // primary brand — buttons, links, focus rings
  accentSoft: "#67E8F9", // light accent, hovers
  accentDeep: "#0E7490", // pressed / deep accent
  accentBg: "#ECFEFF", // accent-tinted background
  accentBg2: "#CFFAFE", // accent tint, stronger
  cyan: "#22D3EE", // secondary brand pop
  pink: "#F472B6",
  peach: "#FDA4AF",
  mint: "#86EFAC"
};

// Cyan ramp (50→700) anchored on the handoff aqua tokens — drives `brand-*`.
export const brandScale = {
  50: "#ECFEFF",
  100: "#CFFAFE",
  200: "#A5F3FC",
  300: "#67E8F9",
  400: "#22D3EE",
  500: "#06B6D4",
  600: "#0891B2",
  700: "#0E7490"
};

export const semantic = {
  success: "#10B981",
  danger: "#EF4444",
  warning: "#F59E0B",
  white: "#FFFFFF"
};

export const palette = { ...aqua, brandScale, ...semantic };

export const radii = { xs: "6px", sm: "10px", md: "14px", lg: "20px", xl: "28px", pill: "999px" };

export const spacing = { xxs: "4px", xs: "8px", sm: "12px", md: "16px", lg: "24px", xl: "32px", xxl: "48px" };

export const fontSize = {
  xs: "11px", sm: "13px", md: "15px", base: "16px", lg: "18px",
  xl: "22px", xxl: "28px", display: "36px", hero: "48px"
};

export const shadows = {
  card: "0 2px 6px rgba(15,17,21,0.04)",
  glow: "0 4px 10px rgba(6,182,212,0.16)",
  pop: "0 16px 32px rgba(26,19,48,0.22)"
};

// Brand gradient (hero text, tab indicator, brand strips).
export const brandGradient = "linear-gradient(135deg, #06B6D4 0%, #22D3EE 50%, #0E7490 100%)";

// gradientFromString: stable aqua pair per string (avatars, category coloring).
export const GRADIENTS = [
  ["#06B6D4", "#67E8F9"],
  ["#0E7490", "#22D3EE"],
  ["#22D3EE", "#86EFAC"],
  ["#06B6D4", "#0E7490"],
  ["#67E8F9", "#06B6D4"],
  ["#0891B2", "#22D3EE"]
];

export function gradientFromString(s = "") {
  const seed = [...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0);
  return GRADIENTS[seed % GRADIENTS.length]; // [from, to]
}

/**
 * CSS-variable values per theme. Names match index.css exactly so they slot in
 * without renaming anything. Light is the canonical aqua design; dark keeps the
 * existing dark neutrals but swaps the brand/ring/ambient to aqua so the brand
 * is consistent across modes.
 */
export const cssVars = {
  light: {
    "--bg": "#F7F7F9",
    "--bg-elev": "#FFFFFF",
    "--surface": "#FFFFFF",
    "--surface-hi": "#F2F2F5",
    "--surface-max": "#E7E7EC",
    "--line": "#E7E7EC",
    "--line-hi": "#D4D4DC",
    "--ink": "#0F1115",
    "--ink-soft": "#4B5563",
    "--ink-mute": "#686B77",
    "--ink-faint": "#9097A3",
    "--ring": "#06B6D4"
  },
  dark: {
    "--bg": "#09090c",
    "--bg-elev": "#0f1015",
    "--surface": "#121319",
    "--surface-hi": "#1a1c23",
    "--surface-max": "#22242c",
    "--line": "#272933",
    "--line-hi": "#383b48",
    "--ink": "#f7f8fb",
    "--ink-soft": "#d4d6dd",
    "--ink-mute": "#9b9faa",
    "--ink-faint": "#696c77",
    "--ring": "#22D3EE"
  }
};

export default {
  aqua, brandScale, semantic, palette, radii, spacing, fontSize,
  shadows, brandGradient, GRADIENTS, gradientFromString, cssVars
};

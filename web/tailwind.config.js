import theme from "./src/theme/theme.config.js";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        /**
         * Theme tokens come straight from CSS variables. Plain `var(--x)`
         * gives Tailwind a normal CSS value to drop into utilities, so
         * `bg-surface` compiles to `background-color: var(--surface)` — no
         * alpha-value indirection, fully predictable.
         */
        bg: "var(--bg)",
        bgElev: "var(--bg-elev)",
        surface: "var(--surface)",
        surfaceHi: "var(--surface-hi)",
        surfaceMax: "var(--surface-max)",
        line: "var(--line)",
        lineHi: "var(--line-hi)",
        ink: "var(--ink)",
        inkSoft: "var(--ink-soft)",
        inkMute: "var(--ink-mute)",
        inkFaint: "var(--ink-faint)",
        ring: "var(--ring)",

        // Brand ramp + semantics come from the single-source theme config.
        brand: theme.brandScale,
        positive: theme.semantic.success,
        positiveHi: "#34D399",
        neutral: "#94a3b8",
        negative: theme.semantic.danger,
        negativeHi: "#F87171",
        warn: theme.semantic.warning,
        info: theme.aqua.cyan,

        // Categorical accents (avatars, tags, charts)
        cyan: theme.aqua.cyan,
        pink: theme.aqua.pink,
        peach: theme.aqua.peach,
        mint: theme.aqua.mint,
        success: theme.semantic.success,
        danger: theme.semantic.danger,
        warning: theme.semantic.warning,

        // Legacy aliases
        background: "var(--bg)",
        panel: "var(--surface)",
        panelHi: "var(--surface-hi)",
        text: "var(--ink)",
        muted: "var(--ink-mute)",
        mutedHi: "var(--ink-soft)",
        border: "var(--line)",
        borderHi: "var(--line-hi)",
        accent: {
          DEFAULT: theme.aqua.accent,
          soft: theme.aqua.accentSoft,
          deep: theme.aqua.accentDeep,
          bg: theme.aqua.accentBg,
          bg2: theme.aqua.accentBg2
        },
        accentHi: theme.aqua.cyan
      },
      backgroundImage: {
        "brand-grad": theme.brandGradient
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow-md)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        pop: "var(--shadow-pop)",
        glow: theme.shadows.glow,
        focus: "0 0 0 3px color-mix(in srgb, var(--ring) 40%, transparent)"
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "monospace"]
      },
      letterSpacing: {
        tightest: "-0.045em",
        tighter2: "-0.025em"
      },
      keyframes: {
        "fade-in": { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        "fade-scale": {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" }
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" }
        },
        "pulse-dot": {
          "0%, 100%": { transform: "scale(1)", opacity: "0.6" },
          "50%": { transform: "scale(1.6)", opacity: "0" }
        }
      },
      animation: {
        "fade-in": "fade-in 0.24s cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-up": "fade-up 0.36s cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-scale": "fade-scale 0.28s cubic-bezier(0.22, 1, 0.36, 1) both",
        shimmer: "shimmer 2s linear infinite",
        "pulse-dot": "pulse-dot 1.8s cubic-bezier(0.22, 1, 0.36, 1) infinite"
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.22, 1, 0.36, 1)",
        snap: "cubic-bezier(0.85, 0, 0.15, 1)"
      },
      transitionDuration: {
        180: "180ms",
        280: "280ms"
      }
    }
  },
  plugins: []
};

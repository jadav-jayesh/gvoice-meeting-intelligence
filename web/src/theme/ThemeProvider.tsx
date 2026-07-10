import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import { applyThemeVars } from "./applyTheme";

type Theme = "light" | "dark";
type ThemePreference = Theme | "system";

interface ThemeCtx {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  toggle: () => void;
}

const STORAGE_KEY = "gvoice:theme";
const ThemeContext = createContext<ThemeCtx | null>(null);

function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(preference: ThemePreference): Theme {
  return preference === "system" ? getSystemTheme() : preference;
}

// Mutate the DOM immediately — no waiting for React effects.
function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  root.style.colorScheme = theme;
  // Re-assert the aqua CSS variables for this mode from the single-source config.
  applyThemeVars(theme);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    if (typeof window === "undefined") return "system";
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  });
  const [theme, setThemeState] = useState<Theme>(() => resolveTheme(preference));

  // Re-apply on mount and whenever theme changes (covers system-pref changes).
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // When preference is "system", follow OS changes.
  useEffect(() => {
    if (preference !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    function handler() {
      const next = getSystemTheme();
      setThemeState(next);
      applyTheme(next);
    }
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [preference]);

  // Imperative setter: flip the DOM right now, persist, then update state.
  const setPreference = useCallback((value: ThemePreference) => {
    const resolved = resolveTheme(value);
    applyTheme(resolved);
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {}
    setPreferenceState(value);
    setThemeState(resolved);
  }, []);

  const toggle = useCallback(() => {
    setPreference(theme === "dark" ? "light" : "dark");
  }, [theme, setPreference]);

  const value = useMemo(
    () => ({ theme, preference, setPreference, toggle }),
    [theme, preference, setPreference, toggle]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BrandLogo } from "../../components/BrandLogo";
import { useTheme } from "../../theme/ThemeProvider";

/**
 * Shared chrome for the public legal pages (Privacy Policy, Terms).
 *
 * Reuses the marketing site's `.gv` design tokens (same values as
 * LandingPage's <style> block) so the legal pages match the brand in both
 * light and dark themes, while staying fully self-contained (these routes are
 * public and render outside the authenticated app shell).
 */
export function LegalLayout({
  title,
  updated,
  intro,
  children
}: {
  title: string;
  updated: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  const { theme, toggle } = useTheme();

  // Public pages can be deep-linked; always start at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="gv relative min-h-dvh w-full bg-[var(--gv-bg)] font-sans text-[rgb(var(--gv-fg))] antialiased">
      <LegalTokens />

      <header className="sticky top-0 z-50 border-b border-[rgb(var(--gv-fg)_/_0.1)] bg-[var(--gv-bg-strong)] backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link to="/" className="flex items-center" aria-label="gVoice home">
            <BrandLogo height={28} />
          </Link>
          <div className="flex items-center gap-2.5">
            <button
              onClick={toggle}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              className="grid h-8 w-8 place-items-center rounded-lg text-[rgb(var(--gv-fg)_/_0.6)] transition-colors hover:bg-[rgb(var(--gv-fg)_/_0.08)] hover:text-[rgb(var(--gv-fg))] focus-ring"
            >
              {theme === "dark" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
            <Link
              to="/login"
              className="hidden rounded-lg px-3 py-2 text-[13.5px] font-medium text-[rgb(var(--gv-fg)_/_0.75)] transition-colors hover:text-[rgb(var(--gv-fg))] sm:block"
            >
              Log in
            </Link>
            <Link
              to="/signup"
              className="inline-flex h-9 items-center rounded-lg gv-cta px-4 text-[13px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(34,211,238,0.8)] transition-transform hover:-translate-y-0.5 focus-ring"
            >
              Start Free
            </Link>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
        <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--gv-accent)]">Legal</p>
        <h1 className="mt-3 text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] text-[rgb(var(--gv-fg))] sm:text-[40px]">
          {title}
        </h1>
        <p className="mt-3 text-[13.5px] text-[rgb(var(--gv-fg)_/_0.45)]">Last updated: {updated}</p>
        {intro && <div className="mt-6 text-[15.5px] leading-relaxed text-[var(--gv-text2)]">{intro}</div>}

        <div className="mt-10 space-y-9">{children}</div>

        <div className="mt-16 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[rgb(var(--gv-fg)_/_0.1)] pt-6 text-[13px] text-[rgb(var(--gv-fg)_/_0.5)]">
          <Link to="/" className="transition-colors hover:text-[rgb(var(--gv-fg))]">← Back to home</Link>
          <Link to="/privacy" className="transition-colors hover:text-[rgb(var(--gv-fg))]">Privacy Policy</Link>
          <Link to="/terms" className="transition-colors hover:text-[rgb(var(--gv-fg))]">Terms &amp; Conditions</Link>
        </div>
        <p className="mt-6 text-[12px] text-[rgb(var(--gv-fg)_/_0.35)]">
          © 2015–2026 GROOVY TECHNOWEB PRIVATE LIMITED. All rights reserved. gVoice is a product of Groovy Technoweb Private Limited.
        </p>
      </main>
    </div>
  );
}

/* ── Prose helpers ─────────────────────────────────────────────────────── */

export function Section({ n, title, children }: { n?: string; title: string; children: ReactNode }) {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-[rgb(var(--gv-fg))] sm:text-[22px]">
        {n && <span className="text-[var(--gv-accent)]">{n}. </span>}
        {title}
      </h2>
      <div className="mt-3 space-y-3.5 text-[15px] leading-relaxed text-[var(--gv-text2)]">{children}</div>
    </section>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p>{children}</p>;
}

export function UL({ children }: { children: ReactNode }) {
  return <ul className="space-y-2 pl-1">{children}</ul>;
}

export function LI({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span aria-hidden className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--gv-accent)]" />
      <span>{children}</span>
    </li>
  );
}

export function B({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-[rgb(var(--gv-fg)_/_0.92)]">{children}</strong>;
}

export function Mail({ address }: { address: string }) {
  return (
    <a href={`mailto:${address}`} className="font-medium text-[var(--gv-accent)] underline-offset-2 hover:underline">
      {address}
    </a>
  );
}

/** A bordered callout for important notices (e.g. recording consent). */
export function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[rgb(var(--gv-fg)_/_0.12)] bg-[rgb(var(--gv-fg)_/_0.03)] p-4 text-[14.5px] leading-relaxed text-[var(--gv-text2)]">
      {children}
    </div>
  );
}

/** A simple two-column table for the sub-processor list. */
export function SubProcessorTable({ rows }: { rows: { name: string; purpose: string; location: string }[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[rgb(var(--gv-fg)_/_0.12)]">
      <table className="w-full border-collapse text-left text-[14px]">
        <thead>
          <tr className="bg-[rgb(var(--gv-fg)_/_0.04)] text-[12px] uppercase tracking-wider text-[rgb(var(--gv-fg)_/_0.5)]">
            <th className="px-4 py-3 font-semibold">Provider</th>
            <th className="px-4 py-3 font-semibold">Purpose</th>
            <th className="px-4 py-3 font-semibold">Region</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-[rgb(var(--gv-fg)_/_0.08)] align-top text-[var(--gv-text2)]">
              <td className="px-4 py-3 font-medium text-[rgb(var(--gv-fg)_/_0.9)]">{r.name}</td>
              <td className="px-4 py-3">{r.purpose}</td>
              <td className="px-4 py-3">{r.location}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** `.gv` design tokens — mirrors LandingPage's <style> block (light + dark). */
function LegalTokens() {
  return (
    <style>{`
      .gv {
        --gv-fg: 255 255 255;
        --gv-bg: #09090c;
        --gv-bg-strong: rgba(9, 9, 12, 0.8);
        --gv-surface: #121319;
        --gv-text2: #A8B3CF;
        --gv-accent: #06B6D4;
      }
      html:not(.dark) .gv {
        --gv-fg: 15 23 42;
        --gv-bg: #F3F6FC;
        --gv-bg-strong: rgba(243, 246, 252, 0.82);
        --gv-surface: #FFFFFF;
        --gv-text2: #475569;
        --gv-accent: #0891B2;
      }
      .gv-cta { background-image: linear-gradient(90deg, #06B6D4, #22D3EE); }
      .gv a { text-underline-offset: 2px; }
    `}</style>
  );
}

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { BrandLogo } from "../components/BrandLogo";
import { useTheme } from "../theme/ThemeProvider";
import { buildMomHtml } from "../lib/mom";
import type { Meeting } from "../lib/types";

/**
 * gVoice — "The AI Operating System for Meetings" marketing site.
 *
 * A self-contained, forced-dark premium experience (Linear/Vercel/Stripe-grade
 * polish) using the gVoice brand system. Motion is hand-rolled (CSS keyframes +
 * rAF parallax + IntersectionObserver reveals) to keep the bundle light while
 * matching framer-grade quality, and all of it respects prefers-reduced-motion.
 *
 * The "Executive-Ready Reports" centerpiece embeds the REAL report generator
 * (lib/mom.ts) so the preview/download are byte-identical to the live product.
 */
export function LandingPage() {
  const [momOpen, setMomOpen] = useState(false);

  useEffect(() => {
    const prevTitle = document.title;
    document.title = "gVoice — The AI Operating System for Meetings";
    const meta = document.querySelector('meta[name="description"]') ?? document.createElement("meta");
    meta.setAttribute("name", "description");
    meta.setAttribute(
      "content",
      "gVoice joins your meetings, captures every discussion, identifies speakers, extracts action items, tracks decisions, and generates executive-ready reports — automatically."
    );
    if (!meta.parentNode) document.head.appendChild(meta);
    return () => {
      document.title = prevTitle;
    };
  }, []);

  return (
    <div className="gv relative min-h-dvh w-full overflow-x-clip bg-[var(--gv-bg)] font-sans text-[rgb(var(--gv-fg))] antialiased selection:bg-[#06B6D4]/30">
      <Atmosphere />
      <AccountDeletedToast />
      <Nav />
      <main className="relative z-10">
        <Hero onWatchDemo={() => setMomOpen(true)} />
        <SocialProof />
        <Problem />
        <Solution />
        <FeatureAssistant />
        <FeatureSummaries />
        <FeatureActions />
        <FeatureReports onPreview={() => setMomOpen(true)} />
        <FeatureInsights />
        <HowItWorks />
        <Comparison />
        <Testimonials />
        <Security />
        <FinalCta />
      </main>
      <Footer />
      <MomModal open={momOpen} onClose={() => setMomOpen(false)} />
      <GVStyles />
    </div>
  );
}

// One-shot confirmation shown after a user deletes their account; the delete
// flow redirects here with ?deleted=1. We clear the param immediately so a
// refresh or shared link doesn't replay it, then auto-dismiss after a few s.
function AccountDeletedToast() {
  const [params, setParams] = useSearchParams();
  const [show, setShow] = useState(params.get("deleted") === "1");
  useEffect(() => {
    if (params.get("deleted") !== "1") return;
    const next = new URLSearchParams(params);
    next.delete("deleted");
    setParams(next, { replace: true });
    setShow(true);
    const t = window.setTimeout(() => setShow(false), 6000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!show) return null;
  return (
    <div className="fixed inset-x-0 top-20 z-[120] flex justify-center px-4 animate-[gvFade_.2s_ease]">
      <div className="flex items-center gap-3 rounded-xl border border-[rgb(var(--gv-fg)_/_0.12)] bg-[var(--gv-surface)] px-4 py-3 shadow-[0_20px_60px_-20px_rgba(34,211,238,0.5),0_10px_30px_-15px_rgba(0,0,0,0.6)]">
        <span className="grid h-7 w-7 place-items-center rounded-full gv-grad text-white">
          <Icon.Check size={15} />
        </span>
        <p className="text-[13.5px] font-medium text-[rgb(var(--gv-fg))]">Your account has been deleted.</p>
        <button
          onClick={() => setShow(false)}
          aria-label="Dismiss"
          className="ml-1 grid h-6 w-6 place-items-center rounded-md text-[rgb(var(--gv-fg)_/_0.5)] transition-colors hover:bg-[rgb(var(--gv-fg)_/_0.08)] hover:text-[rgb(var(--gv-fg))]"
        >
          <Icon.Close size={13} />
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════ Motion primitives ════════════════════════ */

function Floating({ depth = 26, delay = 0, duration = 7, className, style, children }: { depth?: number; delay?: number; duration?: number; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <div className={`gv-parallax absolute ${className ?? ""}`} style={{ ["--depth" as string]: `${depth}px`, ...style }}>
      <div className="gv-floaty" style={{ animationDelay: `${delay}s`, animationDuration: `${duration}s` }}>
        {children}
      </div>
    </div>
  );
}

function TiltCard({ children, className, max = 6 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const reset = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--mx", "50%");
    el.style.setProperty("--my", "50%");
  };
  const onMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--ry", `${(x - 0.5) * max * 2}deg`);
    el.style.setProperty("--rx", `${(0.5 - y) * max * 2}deg`);
    el.style.setProperty("--mx", `${x * 100}%`);
    el.style.setProperty("--my", `${y * 100}%`);
  };
  return (
    <div ref={ref} onPointerMove={onMove} onPointerLeave={reset} className={`gv-tilt group relative h-full ${className ?? ""}`}>
      <div className="gv-tilt-inner relative h-full">{children}</div>
    </div>
  );
}

function CountUp({ to, decimals = 0, prefix = "", suffix = "", duration = 1500 }: { to: number; decimals?: number; prefix?: string; suffix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [val, setVal] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVal(to);
      return;
    }
    let raf = 0;
    let start = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        const step = (t: number) => {
          if (!start) start = t;
          const p = Math.min(1, (t - start) / duration);
          setVal(to * (1 - Math.pow(1 - p, 3)));
          if (p < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [to, duration]);
  return (
    <span ref={ref}>
      {prefix}
      {val.toFixed(decimals)}
      {suffix}
    </span>
  );
}

function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.1 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`gv-reveal ${shown ? "gv-in" : ""} ${className ?? ""}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/* ════════════════════════ Shared UI ════════════════════════ */

function PrimaryBtn({ to, children, size = "md", trailing, onClick, className }: { to?: string; children: ReactNode; size?: "md" | "lg"; trailing?: ReactNode; onClick?: () => void; className?: string }) {
  const dims = size === "lg" ? "h-12 px-6 text-[15px]" : "h-10 px-5 text-[14px]";
  const cls = `group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl font-semibold text-white gv-cta ${dims} shadow-[0_0_0_1px_rgba(6,182,212,0.4),0_12px_36px_-10px_rgba(34,211,238,0.7)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_rgba(6,182,212,0.55),0_18px_48px_-10px_rgba(34,211,238,0.95)] active:translate-y-0 focus-ring ${className ?? ""}`;
  const inner = (
    <>
      <span aria-hidden className="gv-sheen pointer-events-none absolute inset-0" />
      <span className="relative inline-flex items-center gap-2">
        {children}
        {trailing}
      </span>
    </>
  );
  if (to) return <Link to={to} className={cls}>{inner}</Link>;
  return <button onClick={onClick} className={cls}>{inner}</button>;
}

function SecondaryBtn({ href, onClick, children, icon }: { href?: string; onClick?: () => void; children: ReactNode; icon?: ReactNode }) {
  const cls = "inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-[rgb(var(--gv-fg)_/_0.12)] bg-[rgb(var(--gv-fg)_/_0.05)] px-6 text-[15px] font-medium text-[rgb(var(--gv-fg)_/_0.9)] backdrop-blur transition-colors hover:bg-[rgb(var(--gv-fg)_/_0.1)] focus-ring";
  if (href) return <a href={href} className={cls}>{icon}{children}</a>;
  return <button onClick={onClick} className={cls}>{icon}{children}</button>;
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="gv-ring relative inline-flex items-center gap-2 overflow-hidden rounded-full border border-[rgb(var(--gv-fg)_/_0.1)] bg-[rgb(var(--gv-fg)_/_0.04)] px-3.5 py-1.5 text-[11.5px] font-semibold uppercase tracking-[0.16em] text-[rgb(var(--gv-fg)_/_0.7)] backdrop-blur">
      <Icon.Sparkles size={12} className="text-[var(--gv-accent)]" />
      {children}
    </span>
  );
}

function SectionHead({ eyebrow, title, subtitle, center = true }: { eyebrow: string; title: ReactNode; subtitle?: string; center?: boolean }) {
  return (
    <Reveal className={center ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-5 text-[30px] font-semibold leading-[1.08] tracking-[-0.03em] text-[rgb(var(--gv-fg))] sm:text-[44px]">{title}</h2>
      {subtitle && <p className="mt-4 text-[16px] leading-relaxed text-[var(--gv-text2)]">{subtitle}</p>}
    </Reveal>
  );
}

// A glass panel with an optional gradient hairline border.
function Glass({ className, children, ring }: { className?: string; children: ReactNode; ring?: boolean }) {
  return <div className={`gv-glass ${ring ? "gv-card-ring" : ""} relative rounded-2xl ${className ?? ""}`}>{children}</div>;
}

/* ════════════════════════ Atmosphere ════════════════════════ */

function Atmosphere() {
  return (
    <div aria-hidden className="gv-atmos">
      <div className="gv-orb gv-drift" style={{ top: "-8%", left: "8%", width: 560, height: 560, background: "radial-gradient(circle, rgba(6,182,212,0.15), transparent 70%)" }} />
      <div className="gv-orb gv-drift-slow" style={{ top: "26%", right: "4%", width: 620, height: 620, background: "radial-gradient(circle, rgba(14,116,144,0.11), transparent 70%)" }} />
      <div className="gv-orb gv-drift" style={{ bottom: "-10%", left: "30%", width: 680, height: 680, background: "radial-gradient(circle, rgba(34,211,238,0.09), transparent 70%)" }} />
      <div className="gv-grid absolute inset-0" />
      <div className="gv-noise absolute inset-0" />
    </div>
  );
}

/* ════════════════════════ Nav ════════════════════════ */

const navLinks = [
  { label: "Solution", href: "#solution" },
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how" },
  { label: "Security", href: "#security" }
];

// Landing-native theme switcher (light / dark / system) styled with the page's
// own glass + accent language, so the active option is clearly highlighted in
// both themes.
function GVThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="grid h-8 w-8 place-items-center rounded-lg text-[rgb(var(--gv-fg)_/_0.6)] transition-colors hover:bg-[rgb(var(--gv-fg)_/_0.08)] hover:text-[rgb(var(--gv-fg))] focus-ring"
    >
      {isDark ? <MoonGlyph /> : <SunGlyph />}
    </button>
  );
}

function SunGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41 -1.41M17.66 6.34l1.41 -1.41" />
    </svg>
  );
}
function MoonGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
    </svg>
  );
}

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState("");
  useEffect(() => {
    const onScroll = () => setScrolled(scrollY > 8);
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);
  // Scroll-spy: highlight the nav item whose section is currently in view.
  useEffect(() => {
    const els = navLinks
      .map((l) => document.getElementById(l.href.slice(1)))
      .filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    // Track which sections are currently in the active band; if none are
    // (e.g. when the hero/top is in view), clear the active tab entirely.
    const vis = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) vis.set(e.target.id, e.intersectionRatio);
          else vis.delete(e.target.id);
        });
        let best = "";
        let bestRatio = -1;
        vis.forEach((ratio, id) => {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            best = id;
          }
        });
        setActive(best);
      },
      { rootMargin: "-45% 0px -50% 0px", threshold: [0, 0.2, 0.6, 1] }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return (
    <header className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${scrolled ? "border-b border-[rgb(var(--gv-fg)_/_0.1)] bg-[var(--gv-bg-strong)]" : "border-b border-transparent"}`}>
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
        <a href="#top" className="flex items-center" aria-label="gVoice home">
          <BrandLogo height={28} />
        </a>
        <div className="hidden items-center gap-1 rounded-full border border-[rgb(var(--gv-fg)_/_0.1)] bg-[rgb(var(--gv-fg)_/_0.03)] px-1.5 py-1 backdrop-blur lg:flex">
          {navLinks.map((l) => {
            const isActive = active === l.href.slice(1);
            return (
              <a
                key={l.href}
                href={l.href}
                aria-current={isActive ? "true" : undefined}
                onClick={() => setActive(l.href.slice(1))}
                className={`rounded-full px-3.5 py-1.5 text-[13.5px] font-medium transition-colors ${
                  isActive
                    ? "bg-[#06B6D4]/15 text-[var(--gv-accent)]"
                    : "text-[rgb(var(--gv-fg)_/_0.6)] hover:bg-[rgb(var(--gv-fg)_/_0.08)] hover:text-[rgb(var(--gv-fg))]"
                }`}
              >
                {l.label}
              </a>
            );
          })}
        </div>
        <div className="flex items-center gap-2.5">
          <GVThemeToggle />
          <Link to="/login" className="hidden rounded-lg px-3 py-2 text-[13.5px] font-medium text-[rgb(var(--gv-fg)_/_0.75)] transition-colors hover:text-[rgb(var(--gv-fg))] sm:block">
            Log in
          </Link>
          <PrimaryBtn to="/signup">Start Free</PrimaryBtn>
        </div>
      </nav>
    </header>
  );
}

/* ════════════════════════ Hero ════════════════════════ */

const platforms = [
  { name: "Google Meet", logo: "/logo-meet.svg" },
  { name: "Zoom", logo: "/logo-zoom.svg" },
  { name: "Microsoft Teams", logo: "/logo-teams.svg" }
];

function Hero({ onWatchDemo }: { onWatchDemo: () => void }) {
  return (
    <section id="top" className="relative overflow-hidden px-5 pt-28 pb-16 sm:px-8 sm:pt-36 sm:pb-24">
      <div aria-hidden className="gv-hero-aura pointer-events-none absolute inset-0 -z-10" />
      <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[1.02fr_1.05fr]">
        <div className="gv-stagger relative z-10 max-w-xl">
          <Eyebrow>AI Meeting Operating System</Eyebrow>
          <h1 className="mt-6 text-[clamp(34px,9vw,44px)] font-semibold leading-[0.98] tracking-[-0.045em] sm:text-[68px]">
            Meetings End.
            <br />
            <span className="gv-grad-text">Execution Begins.</span>
          </h1>
          <p className="mt-6 max-w-md text-[17px] leading-relaxed text-[var(--gv-text2)] sm:text-[18px]">
            gVoice turns every meeting into decisions, owned action items and executive-ready reports — automatically.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <PrimaryBtn to="/signup" size="lg" trailing={<Icon.ArrowRight size={16} />}>
              Start Free
            </PrimaryBtn>
            <SecondaryBtn onClick={onWatchDemo} icon={<Icon.Play size={14} />}>
              Watch Demo
            </SecondaryBtn>
          </div>
          <div className="mt-8">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--gv-fg)_/_0.35)]">Works on</p>
            <div className="mt-3 flex flex-wrap gap-2.5">
              {platforms.map((p) => (
                <span key={p.name} className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--gv-fg)_/_0.1)] bg-[rgb(var(--gv-fg)_/_0.04)] px-3.5 py-1.5 text-[13px] font-medium text-[rgb(var(--gv-fg)_/_0.8)] backdrop-blur">
                  <img src={p.logo} alt="" aria-hidden className="h-[18px] w-[18px] object-contain" />
                  {p.name}
                </span>
              ))}
            </div>
          </div>
        </div>

        <Reveal className="relative z-10">
          <HeroPipeline />
        </Reveal>
      </div>
    </section>
  );
}

// The hero showpiece: a meeting intelligence pipeline of glass cards connected
// by animated gradient lines, with floating chips and mouse parallax.
function HeroPipeline() {
  return (
    <div className="relative w-full">
      {/* Mobile / tablet (< lg): a clean vertical stack of the same cards — no
          absolute positioning, so nothing can overlap at any width. */}
      <div className="mx-auto grid w-full max-w-md gap-3 lg:hidden">
        <HeroMeetingCard />
        <div className="grid grid-cols-2 gap-3">
          <HeroSpeakerChip />
          <HeroSentimentChip />
          <HeroActionItemsChip />
          <HeroReportChip />
        </div>
      </div>

      {/* Desktop (lg+): the floating collage with animated connectors + parallax. */}
      <div className="relative mx-auto hidden aspect-[5/4.6] w-full max-w-[620px] lg:block">
        {/* animated connectors */}
        <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 500 460" fill="none" preserveAspectRatio="none">
          <defs>
            <linearGradient id="gv-line" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#06B6D4" />
              <stop offset="50%" stopColor="#22D3EE" />
              <stop offset="100%" stopColor="#0E7490" />
            </linearGradient>
          </defs>
          {["M120 96 C 200 96, 230 150, 250 192", "M250 246 C 250 290, 180 300, 132 320", "M250 246 C 250 290, 330 300, 372 320"].map((d, i) => (
            <path key={i} d={d} stroke="url(#gv-line)" strokeWidth="1.5" strokeDasharray="5 6" className="gv-flow" style={{ animationDelay: `${i * 0.4}s` }} opacity="0.6" />
          ))}
        </svg>

        <Floating depth={18} className="left-[11%] top-[24%] w-[78%]"><HeroMeetingCard /></Floating>
        <Floating depth={40} delay={0.6} className="left-[2%] top-[8%]"><HeroSpeakerChip /></Floating>
        <Floating depth={52} delay={1.1} duration={8} className="right-[0%] top-[26%]"><HeroSentimentChip /></Floating>
        <Floating depth={44} delay={1.6} className="bottom-[6%] left-[2%]"><HeroActionItemsChip /></Floating>
        <Floating depth={34} delay={0.9} duration={7.5} className="bottom-[8%] right-[2%]"><HeroReportChip /></Floating>
      </div>
    </div>
  );
}

// Hero collage cards, shared by the desktop floating layout and the mobile
// stacked layout so the two never drift apart.
function HeroMeetingCard() {
  return (
    <Glass ring className="gv-glow p-4">
      <div className="flex items-center gap-2 border-b border-[rgb(var(--gv-fg)_/_0.1)] pb-3">
        <span className="grid h-7 w-7 place-items-center rounded-md gv-grad text-white"><Icon.Video size={14} /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold">Q3 Roadmap Sync</p>
          <p className="text-[10.5px] text-[rgb(var(--gv-fg)_/_0.45)]">Google Meet · live</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#06B6D4]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--gv-accent)]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#06B6D4]" /> REC
        </span>
      </div>
      <div className="mt-3 space-y-2.5">
        <HeroLine initials="MR" name="Maya R." text="Let's lock the launch for September 14." tone="from-[#06B6D4] to-[#22D3EE]" />
        <HeroLine initials="JK" name="Jordan K." text="Engineering can open the beta gate Thursday." tone="from-[#0E7490] to-[#0E7490]" />
        <HeroLine ai initials="AI" name="gVoice" text="Decision detected · 2 action items captured" tone="from-[#06B6D4] to-[#0E7490]" />
      </div>
    </Glass>
  );
}

function HeroSpeakerChip() {
  return (
    <Glass className="flex h-full items-center gap-2.5 px-3.5 py-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#06B6D4]/15 text-[var(--gv-accent)]"><Icon.Users size={15} /></span>
      <div className="min-w-0">
        <p className="text-[11.5px] font-semibold leading-tight">Speaker identified</p>
        <p className="truncate text-[10px] text-[rgb(var(--gv-fg)_/_0.45)]">Maya R. · 98% match</p>
      </div>
    </Glass>
  );
}

function HeroSentimentChip() {
  return (
    <Glass className="flex h-full items-center gap-3 px-3.5 py-2.5">
      <svg width="30" height="30" viewBox="0 0 36 36" className="-rotate-90 shrink-0">
        <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
        <circle cx="18" cy="18" r="15" fill="none" stroke="#06B6D4" strokeWidth="3" strokeLinecap="round" strokeDasharray="94" strokeDashoffset="9" />
      </svg>
      <div>
        <p className="text-[12.5px] font-semibold leading-tight">92%</p>
        <p className="text-[10px] text-[rgb(var(--gv-fg)_/_0.45)]">Positive</p>
      </div>
    </Glass>
  );
}

function HeroActionItemsChip() {
  return (
    <Glass className="h-full px-3.5 py-3">
      <p className="mb-1.5 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-[rgb(var(--gv-fg)_/_0.4)]"><Icon.CheckCircle size={11} className="text-[var(--gv-accent)]" /> Action items</p>
      {["Ship brief — Maya", "Open beta gate — Jordan"].map((t) => (
        <p key={t} className="flex items-center gap-1.5 text-[11px] text-[rgb(var(--gv-fg)_/_0.75)]"><Icon.Check size={10} className="shrink-0 text-[var(--gv-accent)]" /> {t}</p>
      ))}
    </Glass>
  );
}

function HeroReportChip() {
  return (
    <Glass className="flex h-full items-center gap-2.5 px-3.5 py-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg gv-grad text-white"><Icon.Download size={14} /></span>
      <div className="min-w-0">
        <p className="text-[11.5px] font-semibold leading-tight">Report ready</p>
        <p className="text-[10px] text-[rgb(var(--gv-fg)_/_0.45)]">in 1m 48s</p>
      </div>
    </Glass>
  );
}

function HeroLine({ initials, name, text, tone, ai }: { initials: string; name: string; text: string; tone: string; ai?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gradient-to-br text-[9px] font-semibold text-white ${tone}`}>{initials}</span>
      <div className="min-w-0">
        <p className="text-[10px] text-[rgb(var(--gv-fg)_/_0.4)]">{name}</p>
        <p className={`text-[11.5px] leading-snug ${ai ? "font-medium text-[var(--gv-accent)]" : "text-[rgb(var(--gv-fg)_/_0.8)]"}`}>{text}</p>
      </div>
    </div>
  );
}

/* ════════════════════════ Social proof ════════════════════════ */

const metrics = [
  { node: <><CountUp to={12} suffix="k+" /></>, label: "Meetings processed" },
  { node: <CountUp to={98} suffix="%" />, label: "Speaker accuracy" },
  { node: <>&lt;2 min</>, label: "Report generation" },
  { node: <CountUp to={4.9} decimals={1} suffix="/5" />, label: "Customer satisfaction" }
];
const logos = ["Northwind", "Helix Labs", "Orbital", "Lumenly", "Vertex", "Cobalt"];

function SocialProof() {
  return (
    <section className="border-y border-[rgb(var(--gv-fg)_/_0.06)] px-5 py-14 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <dl className="grid grid-cols-2 gap-y-8 sm:grid-cols-4">
            {metrics.map((m, i) => (
              <div key={i} className="text-center">
                <dd className="gv-grad-text text-[34px] font-semibold tabular-nums tracking-tight sm:text-[44px]">{m.node}</dd>
                <dt className="mt-1 text-[12px] uppercase tracking-widest text-[rgb(var(--gv-fg)_/_0.4)]">{m.label}</dt>
              </div>
            ))}
          </dl>
        </Reveal>
        <div className="mt-12">
          <p className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--gv-fg)_/_0.3)]">Trusted by modern teams</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
            {logos.map((l) => (
              <span key={l} className="inline-flex items-center gap-2 text-[15px] font-semibold text-[rgb(var(--gv-fg)_/_0.35)]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" /><path d="M8 12.5l2.5 2.5 5-5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                {l}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ════════════════════════ Problem ════════════════════════ */

const problems = [
  { icon: <Icon.Search size={20} />, title: "Decisions get lost", desc: "Critical discussions disappear inside hour-long recordings nobody re-watches." },
  { icon: <Icon.AlertCircle size={20} />, title: "Action items are forgotten", desc: "Ownership becomes unclear the moment the call ends, and follow-through slips." },
  { icon: <Icon.Clock size={20} />, title: "Manual follow-ups waste hours", desc: "Teams spend their time writing notes and recaps instead of actually executing." }
];

function Problem() {
  return (
    <section className="relative px-5 py-24 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <SectionHead eyebrow="The problem" title={<>Most meetings create <span className="gv-grad-text">more work.</span></>} />
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {problems.map((p, i) => (
            <Reveal key={p.title} delay={i * 90}>
              <Glass className="gv-lift h-full p-7">
                <span className="grid h-12 w-12 place-items-center rounded-xl border border-[rgb(var(--gv-fg)_/_0.1)] bg-[rgb(var(--gv-fg)_/_0.04)] text-[#0E7490]">{p.icon}</span>
                <h3 className="mt-5 text-[18px] font-semibold">{p.title}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--gv-text2)]">{p.desc}</p>
              </Glass>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ════════════════════════ Solution timeline ════════════════════════ */

const flow = [
  { icon: <Icon.Video size={16} />, t: "AI joins meeting" },
  { icon: <Icon.Mic size={16} />, t: "Captures discussion" },
  { icon: <Icon.Users size={16} />, t: "Identifies speakers" },
  { icon: <Icon.CheckCircle size={16} />, t: "Detects decisions" },
  { icon: <Icon.Layers size={16} />, t: "Extracts tasks" },
  { icon: <Icon.Download size={16} />, t: "Generates reports" },
  { icon: <Icon.Trend size={16} />, t: "Tracks ownership" }
];

function Solution() {
  return (
    <section id="solution" className="relative border-y border-[rgb(var(--gv-fg)_/_0.06)] bg-[rgb(var(--gv-fg)_/_0.015)] px-5 py-24 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <SectionHead eyebrow="The solution" title={<>From conversation to <span className="gv-grad-text">accountability.</span></>} subtitle="gVoice automatically transforms meetings into structured knowledge and trackable outcomes — no manual work required." />
        <Reveal className="mt-14">
          <div className="relative sm:overflow-x-auto">
            {/* The connecting line only reads correctly across the single desktop
                row — hide it on mobile where the steps wrap into a grid. */}
            <div aria-hidden className="absolute left-0 right-0 top-[26px] hidden h-px bg-gradient-to-r from-transparent via-[#06B6D4]/40 to-transparent sm:block" />
            {/* Mobile: a centered wrapping grid of step chips (no cut-off
                horizontal scroll). Desktop (sm+): the original 7-across row. */}
            <ol className="flex flex-wrap justify-center gap-x-4 gap-y-7 sm:grid sm:min-w-0 sm:grid-cols-7 sm:gap-2">
              {flow.map((s, i) => (
                <li key={s.t} className="relative w-[100px] text-center sm:w-auto">
                  <span className="relative z-10 mx-auto grid place-items-center rounded-full border border-[rgb(var(--gv-fg)_/_0.1)] bg-[var(--gv-surface)] text-[var(--gv-accent)]" style={{ height: 52, width: 52 }}>{s.icon}</span>
                  <p className="mx-auto mt-3 max-w-[120px] text-[12.5px] font-medium text-[rgb(var(--gv-fg)_/_0.8)]">{s.t}</p>
                  <span className="mt-1 block text-[10px] font-semibold tabular-nums text-[rgb(var(--gv-fg)_/_0.25)]">0{i + 1}</span>
                </li>
              ))}
            </ol>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ════════════════════════ Feature rows ════════════════════════ */

function FeatureRow({ id, eyebrow, title, desc, features, visual, reverse }: { id?: string; eyebrow: string; title: ReactNode; desc: string; features: string[]; visual: ReactNode; reverse?: boolean }) {
  return (
    <Reveal>
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div className={reverse ? "lg:order-2" : ""} id={id}>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h3 className="mt-5 text-[28px] font-semibold leading-tight tracking-[-0.03em] sm:text-[36px]">{title}</h3>
          <p className="mt-4 text-[16px] leading-relaxed text-[var(--gv-text2)]">{desc}</p>
          <ul className="mt-6 grid grid-cols-2 gap-3">
            {features.map((f) => (
              <li key={f} className="flex items-center gap-2.5 text-[14px] text-[rgb(var(--gv-fg)_/_0.85)]">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#06B6D4]/15 text-[var(--gv-accent)]"><Icon.Check size={12} /></span>
                {f}
              </li>
            ))}
          </ul>
        </div>
        <div className={reverse ? "lg:order-1" : ""}>
          <TiltCard max={5}>{visual}</TiltCard>
        </div>
      </div>
    </Reveal>
  );
}

function FeatureAssistant() {
  return (
    <section id="features" className="relative px-5 py-24 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <SectionHead eyebrow="Feature showcase" title={<>Everything a meeting needs, <span className="gv-grad-text">handled.</span></>} subtitle="One assistant that joins, records, transcribes and understands every conversation — across Meet, Zoom and Teams." />
        <div className="mt-16">
          <FeatureRow
            eyebrow="AI meeting assistant"
            title={<>It shows up so you don't have to</>}
            desc="gVoice auto-joins from your calendar, turns its mic and camera off, records the call, and produces a live, speaker-aware transcript in real time."
            features={["Auto join", "Recording", "Live transcript", "Speaker recognition"]}
            visual={
              <Glass ring className="gv-glow overflow-hidden p-0">
                <div className="flex items-center gap-2 border-b border-[rgb(var(--gv-fg)_/_0.1)] bg-[rgb(var(--gv-fg)_/_0.03)] px-4 py-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
                  <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[#06B6D4]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--gv-accent)]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#06B6D4]" /> Recording</span>
                </div>
                <div className="space-y-3.5 p-5">
                  <HeroLine initials="MR" name="Maya R. · English" text="Let's lock the launch for September 14." tone="from-[#06B6D4] to-[#22D3EE]" />
                  <HeroLine initials="JK" name="Jordan K. · English" text="Engineering can open the beta gate Thursday." tone="from-[#0E7490] to-[#0E7490]" />
                  <HeroLine initials="PA" name="Priya A. · Hindi" text="मैं QA साइकल दो दिन में पूरा कर दूँगी।" tone="from-[#22D3EE] to-[#0E7490]" />
                </div>
              </Glass>
            }
          />
        </div>
      </div>
    </section>
  );
}

function FeatureSummaries() {
  return (
    <section className="relative px-5 py-12 sm:px-8 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <FeatureRow
          reverse
          eyebrow="AI summaries"
          title={<>The recap writes itself</>}
          desc="The moment a call ends, gVoice delivers an executive summary, key takeaways, the moments that mattered, and the decisions that were made."
          features={["Executive summary", "Key takeaways", "Meeting moments", "Important decisions"]}
          visual={
            <Glass ring className="gv-glow p-5">
              <p className="text-[10.5px] font-semibold uppercase tracking-widest text-[rgb(var(--gv-fg)_/_0.4)]">Executive summary</p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--gv-text2)]">The team aligned on a September 14 launch. Marketing owns the brief, Engineering commits the beta gate for Thursday, and QA agreed to a compressed two-day cycle to protect the date.</p>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[["4", "Decisions"], ["7", "Action items"], ["3", "Owners"]].map(([v, k]) => (
                  <div key={k} className="rounded-xl border border-[rgb(var(--gv-fg)_/_0.1)] bg-[rgb(var(--gv-fg)_/_0.03)] px-3 py-2.5 text-center">
                    <p className="gv-grad-text text-[19px] font-semibold">{v}</p>
                    <p className="text-[10px] uppercase tracking-wider text-[rgb(var(--gv-fg)_/_0.4)]">{k}</p>
                  </div>
                ))}
              </div>
            </Glass>
          }
        />
      </div>
    </section>
  );
}

function FeatureActions() {
  const rows = [
    { who: "Maya", task: "Ship marketing brief", due: "Sep 13", st: "In progress" },
    { who: "Jordan", task: "Open beta gate", due: "Sep 11", st: "Open" },
    { who: "Priya", task: "Finish QA cycle", due: "Sep 12", st: "Planned" }
  ];
  return (
    <section className="relative px-5 py-12 sm:px-8 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <FeatureRow
          eyebrow="Action intelligence"
          title={<>Decisions become owned tasks</>}
          desc="gVoice extracts every commitment, assigns it to the right person with a due date, and tracks status until it's done."
          features={["Action extraction", "Owner assignment", "Due dates", "Status tracking"]}
          visual={
            <Glass ring className="gv-glow p-4">
              <div className="flex items-center justify-between px-1 pb-3">
                <p className="text-[10.5px] font-semibold uppercase tracking-widest text-[rgb(var(--gv-fg)_/_0.4)]">Action items</p>
                <span className="text-[10.5px] font-medium text-[var(--gv-accent)]">3 tracked</span>
              </div>
              <div className="space-y-2">
                {rows.map((r) => (
                  <div key={r.task} className="flex items-center gap-2.5 rounded-xl border border-[rgb(var(--gv-fg)_/_0.1)] bg-[rgb(var(--gv-fg)_/_0.03)] px-3 py-2.5">
                    <span className="grid h-4 w-4 place-items-center rounded-[5px] border border-[#06B6D4]/50 bg-[#06B6D4]/15"><Icon.Check size={10} className="text-[var(--gv-accent)]" /></span>
                    <span className="flex-1 text-[12.5px] text-[rgb(var(--gv-fg)_/_0.85)]">{r.task}</span>
                    <span className="text-[11px] text-[rgb(var(--gv-fg)_/_0.4)]">{r.who} · {r.due}</span>
                    <span className="rounded-full bg-[rgb(var(--gv-fg)_/_0.06)] px-2 py-0.5 text-[10px] text-[rgb(var(--gv-fg)_/_0.55)]">{r.st}</span>
                  </div>
                ))}
              </div>
            </Glass>
          }
        />
      </div>
    </section>
  );
}

/* ── The differentiator: executive-ready reports (real generator) ── */

function FeatureReports({ onPreview }: { onPreview: () => void }) {
  return (
    <section className="relative overflow-hidden px-5 py-24 sm:px-8 sm:py-32">
      <div aria-hidden className="gv-hero-aura pointer-events-none absolute inset-0 -z-10 opacity-70" />
      <div className="mx-auto max-w-6xl">
        <SectionHead
          eyebrow="The differentiator"
          title={<>Executive-ready meeting reports.<br /><span className="gv-grad-text">Generated in under 2 minutes.</span></>}
          subtitle="Transform raw conversations into beautifully structured reports your entire organization can use — this is what makes gVoice an operating system, not a note taker."
        />
        <Reveal className="mt-14">
          <div className="relative mx-auto max-w-4xl">
            <div aria-hidden className="pointer-events-none absolute -inset-12 -z-10 rounded-[48px]" style={{ background: "radial-gradient(50% 50% at 50% 40%, rgba(6,182,212,0.28), transparent 70%), radial-gradient(40% 50% at 80% 70%, rgba(14,116,144,0.22), transparent 70%)", filter: "blur(50px)" }} />
            <TiltCard max={3}>
              <button onClick={onPreview} className="group block w-full text-left focus-ring rounded-2xl" aria-label="Preview the full meeting report">
                <Glass ring className="gv-glow overflow-hidden">
                  <div className="flex items-center gap-2 border-b border-[rgb(var(--gv-fg)_/_0.1)] bg-[rgb(var(--gv-fg)_/_0.03)] px-4 py-3">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
                    <span className="ml-3 hidden items-center gap-1.5 rounded-md border border-[rgb(var(--gv-fg)_/_0.1)] bg-[rgb(var(--gv-fg)_/_0.05)] px-3 py-1 text-[11px] text-[rgb(var(--gv-fg)_/_0.45)] sm:flex"><Icon.Lock size={10} /> gVoice-Q3-Roadmap-Sync-Report.html</span>
                    <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[#06B6D4]/15 px-2.5 py-1 text-[10.5px] font-medium text-[var(--gv-accent)]"><Icon.Sparkles size={11} /> AI-generated</span>
                  </div>
                  <div className="relative h-[460px] overflow-hidden bg-[var(--gv-bg)]">
                    <ReportFrame title="Sample meeting report preview" tabIndex={-1} ariaHidden scrolling="no" className="pointer-events-none absolute left-0 top-0 origin-top-left border-0" style={{ width: "131%", height: 1500, transform: "scale(0.78)" }} />
                    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[var(--gv-bg)] to-transparent" />
                    <span className="absolute bottom-6 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-[rgb(var(--gv-fg)_/_0.15)] bg-[var(--gv-surface)] px-5 py-2.5 text-[13.5px] font-medium text-[rgb(var(--gv-fg))] shadow-lg backdrop-blur transition-transform group-hover:-translate-y-0.5">
                      <Icon.Search size={14} className="text-[var(--gv-accent)]" /> Preview the full report
                    </span>
                  </div>
                </Glass>
              </button>
            </TiltCard>

            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <PrimaryBtn onClick={onPreview} trailing={<Icon.ArrowRight size={15} />}>Preview report</PrimaryBtn>
              <SecondaryBtn onClick={downloadMom} icon={<Icon.Download size={14} />}>Download sample</SecondaryBtn>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[12.5px] text-[rgb(var(--gv-fg)_/_0.45)]">
              {["Executive summary", "Sentiment analysis", "Key decisions", "Meeting timeline", "Risks & blockers", "Action items", "Attendees", "Ownership tracking"].map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5"><Icon.Check size={12} className="text-[var(--gv-accent)]" /> {t}</span>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function FeatureInsights() {
  return (
    <section className="relative px-5 py-12 sm:px-8 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <FeatureRow
          reverse
          eyebrow="Meeting insights"
          title={<>See the story behind <span className="gv-grad-text">every meeting</span></>}
          desc="gVoice reads sentiment across the whole conversation, flags the moments that mattered, and shows how each person contributed."
          features={["Sentiment timeline", "Key moments", "Per-speaker breakdown", "Talk-time & participation"]}
          visual={
            <Glass ring className="gv-glow overflow-hidden p-5">
              {/* header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#06B6D4] opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[#06B6D4]" />
                  </span>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-[rgb(var(--gv-fg)_/_0.45)]">Meeting sentiment</p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#06B6D4]/15 px-2.5 py-1 text-[11px] font-semibold text-[var(--gv-accent)]"><Icon.Trend size={11} /> +18%</span>
              </div>

              {/* trend chart */}
              <div className="relative mt-4">
                <svg viewBox="0 0 320 120" className="w-full" style={{ height: 132 }} fill="none" preserveAspectRatio="none" aria-hidden>
                  <defs>
                    <linearGradient id="gv-ins-line" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#06B6D4" /><stop offset="55%" stopColor="#22D3EE" /><stop offset="100%" stopColor="#0E7490" /></linearGradient>
                    <linearGradient id="gv-ins-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#06B6D4" stopOpacity="0.30" /><stop offset="100%" stopColor="#06B6D4" stopOpacity="0" /></linearGradient>
                  </defs>
                  {[24, 60, 96].map((y) => <line key={y} x1="0" y1={y} x2="320" y2={y} stroke="var(--gv-grid-line)" strokeWidth="1" strokeDasharray="3 5" />)}
                  <path d="M0 96 C 50 88, 70 100, 100 70 S 170 36, 210 52 S 270 18, 320 26 L320 120 L0 120 Z" fill="url(#gv-ins-fill)" />
                  <path d="M0 96 C 50 88, 70 100, 100 70 S 170 36, 210 52 S 270 18, 320 26" stroke="url(#gv-ins-line)" strokeWidth="2.75" strokeLinecap="round" style={{ filter: "drop-shadow(0 6px 12px rgba(6,182,212,0.4))" }} />
                  {[[100, 70], [210, 52], [304, 27]].map(([x, y], i) => (
                    <circle key={i} cx={x} cy={y} r={i === 2 ? 4.5 : 3} fill="var(--gv-bg)" stroke="#06B6D4" strokeWidth="2" />
                  ))}
                </svg>
                <span className="absolute right-0 top-0 inline-flex items-center gap-1.5 rounded-lg border border-[rgb(var(--gv-fg)_/_0.1)] bg-[var(--gv-surface)] px-2 py-1 text-[10.5px] font-semibold shadow-lg">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#06B6D4]" /> 92% positive
                </span>
                <div className="mt-2 flex justify-between text-[9.5px] uppercase tracking-wider text-[rgb(var(--gv-fg)_/_0.35)]">
                  <span>00:00</span><span>10:00</span><span>22:00</span><span>32:00</span>
                </div>
              </div>

              {/* stat mini-cards */}
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  { v: "92%", k: "Positive", icon: <Icon.Trend size={12} /> },
                  { v: "8", k: "Key moments", icon: <Icon.Sparkles size={12} /> },
                  { v: "5", k: "Speakers", icon: <Icon.Users size={12} /> }
                ].map((s) => (
                  <div key={s.k} className="rounded-xl border border-[rgb(var(--gv-fg)_/_0.1)] bg-[rgb(var(--gv-fg)_/_0.03)] p-3">
                    <span className="grid h-6 w-6 place-items-center rounded-md bg-[#06B6D4]/12 text-[var(--gv-accent)]">{s.icon}</span>
                    <p className="gv-grad-text mt-2 text-[20px] font-bold leading-none tabular-nums">{s.v}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-wider text-[rgb(var(--gv-fg)_/_0.4)]">{s.k}</p>
                  </div>
                ))}
              </div>

              {/* top contributors */}
              <div className="mt-3 flex items-center justify-between rounded-xl border border-[rgb(var(--gv-fg)_/_0.1)] bg-[rgb(var(--gv-fg)_/_0.03)] px-3.5 py-2.5">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[rgb(var(--gv-fg)_/_0.4)]">Speakers</span>
                <div className="flex -space-x-2">
                  {[["MR", "from-[#06B6D4] to-[#22D3EE]"], ["JK", "from-[#0E7490] to-[#0E7490]"], ["PA", "from-[#22D3EE] to-[#0E7490]"], ["DV", "from-[#06B6D4] to-[#0E7490]"]].map(([t, c]) => (
                    <span key={t} className={`grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br ${c} text-[9px] font-semibold text-white ring-2 ring-[var(--gv-surface)]`}>{t}</span>
                  ))}
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-[rgb(var(--gv-fg)_/_0.08)] text-[9px] font-semibold text-[rgb(var(--gv-fg)_/_0.6)] ring-2 ring-[var(--gv-surface)]">+2</span>
                </div>
              </div>
            </Glass>
          }
        />
      </div>
    </section>
  );
}

/* ════════════════════════ How it works ════════════════════════ */

const steps = [
  { icon: <Icon.Video size={18} />, t: "AI joins meeting", d: "Auto-joins from your calendar across Meet, Zoom and Teams." },
  { icon: <Icon.Mic size={18} />, t: "Captures conversation", d: "Records and transcribes every word, live, with speaker labels." },
  { icon: <Icon.Brain size={18} />, t: "Analyzes discussion", d: "Detects decisions, sentiment and the moments that matter." },
  { icon: <Icon.Download size={18} />, t: "Creates report", d: "Generates an executive-ready report in under two minutes." },
  { icon: <Icon.CheckCircle size={18} />, t: "Assigns ownership", d: "Turns commitments into owned action items with due dates." },
  { icon: <Icon.Trend size={18} />, t: "Tracks progress", d: "Follows every task and rolls it up into team insights." }
];

function HowItWorks() {
  return (
    <section id="how" className="relative px-5 py-24 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <SectionHead eyebrow="How it works" title={<>From meeting to accountability <span className="gv-grad-text">in minutes</span></>} />
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((s, i) => (
            <Reveal key={s.t} delay={(i % 3) * 90}>
              <Glass ring className="group gv-lift relative h-full overflow-hidden rounded-2xl p-7">
                {/* lit top edge */}
                <span aria-hidden className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[rgb(var(--gv-fg)_/_0.2)] to-transparent" />
                {/* accent glow that blooms on hover */}
                <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full opacity-0 transition-opacity duration-500 group-hover:opacity-100" style={{ background: "radial-gradient(circle, rgba(6,182,212,0.22), transparent 70%)", filter: "blur(18px)" }} />

                <div className="relative flex items-start justify-between">
                  <span className="gv-ring relative grid h-12 w-12 place-items-center overflow-hidden rounded-2xl bg-[#06B6D4]/[0.08] text-[var(--gv-accent)] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)] transition-transform duration-300 ease-out group-hover:-rotate-6 group-hover:scale-110">
                    {s.icon}
                  </span>
                  <span className="font-mono text-[34px] font-bold leading-none tabular-nums text-[rgb(var(--gv-fg)_/_0.09)] transition-colors duration-300 group-hover:text-[rgb(var(--gv-fg)_/_0.18)]">0{i + 1}</span>
                </div>

                <h3 className="relative mt-6 text-[18px] font-semibold tracking-tight">{s.t}</h3>
                <p className="relative mt-2 text-[14px] leading-relaxed text-[var(--gv-text2)]">{s.d}</p>

                {/* progress chip */}
                <div className="relative mt-6 inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--gv-fg)_/_0.1)] bg-[rgb(var(--gv-fg)_/_0.03)] px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-wider text-[rgb(var(--gv-fg)_/_0.5)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--gv-accent)]" />
                  Step {i + 1} of {steps.length}
                </div>
              </Glass>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ════════════════════════ Comparison ════════════════════════ */

const compareRows = ["Meeting notes", "Action items", "Speaker tracking", "Decision detection", "Sentiment analysis", "Meeting reports", "Team insights", "Accountability tracking"];

function Comparison() {
  return (
    <section className="relative border-y border-[rgb(var(--gv-fg)_/_0.06)] bg-[rgb(var(--gv-fg)_/_0.015)] px-5 py-24 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <SectionHead
          eyebrow="Why gVoice"
          title={<>Why teams choose <span className="gv-grad-text">gVoice</span></>}
          subtitle="Manual note-taking can't keep up. Here's what changes the moment gVoice joins the call."
        />
        <Reveal className="mt-12">
          <Glass ring className="relative overflow-hidden rounded-2xl p-2 sm:p-3">
            <div className="relative grid grid-cols-[1.5fr_1fr_1.1fr] items-stretch">
              {/* spotlight panel behind the gVoice column (absolute so it doesn't disrupt grid flow) */}
              <div
                aria-hidden
                className="gv-ring pointer-events-none absolute bottom-0 right-0 top-0 w-[30.5%] rounded-xl bg-[#06B6D4]/[0.07]"
                style={{ boxShadow: "0 24px 60px -24px rgba(6,182,212,0.35)" }}
              />

              {/* header */}
              <div className="px-4 py-4 text-[11.5px] font-semibold uppercase tracking-widest text-[rgb(var(--gv-fg)_/_0.4)]">Capability</div>
              <div className="px-4 py-4 text-center text-[11.5px] font-semibold uppercase tracking-widest text-[rgb(var(--gv-fg)_/_0.35)]">Manual notes</div>
              <div className="relative z-10 flex items-center justify-center px-4 py-3">
                <span className="inline-flex items-center gap-1.5 rounded-full gv-grad px-3 py-1.5 text-[12px] font-bold text-white shadow-[0_8px_24px_-8px_rgba(6,182,212,0.8)]">
                  <Icon.Sparkles size={12} /> gVoice
                </span>
              </div>

              {/* rows */}
              {compareRows.flatMap((r, i) => {
                const border = i > 0 ? "border-t border-[rgb(var(--gv-fg)_/_0.06)]" : "";
                return [
                  <div key={r + "-c"} className={`flex items-center px-4 py-3.5 text-[14px] font-medium text-[rgb(var(--gv-fg)_/_0.88)] ${border}`}>{r}</div>,
                  <div key={r + "-m"} className={`flex items-center justify-center px-4 py-3.5 ${border}`}>
                    <span className="grid h-7 w-7 place-items-center rounded-full border border-[rgb(var(--gv-fg)_/_0.1)] text-[rgb(var(--gv-fg)_/_0.3)]"><Icon.Close size={13} /></span>
                  </div>,
                  <div key={r + "-g"} className={`relative z-10 flex items-center justify-center px-4 py-3.5 ${i > 0 ? "border-t border-[#06B6D4]/15" : ""}`}>
                    <span className="grid h-7 w-7 place-items-center rounded-full gv-grad text-white shadow-[0_0_18px_-2px_rgba(6,182,212,0.65)]"><Icon.Check size={15} /></span>
                  </div>
                ];
              })}
            </div>
          </Glass>
        </Reveal>
        <p className="mt-5 text-center text-[13px] text-[rgb(var(--gv-fg)_/_0.45)]">Everything on the right — automatically, in every meeting.</p>
      </div>
    </section>
  );
}

/* ════════════════════════ Testimonials ════════════════════════ */

const quotes = [
  { q: "We completely stopped writing meeting notes. gVoice just does it — better than we ever did.", n: "Maya Rao", r: "Head of Product, Helix Labs", c: "from-[#06B6D4] to-[#22D3EE]" },
  { q: "The report generation alone saves hours every week. It's become how we run the business.", n: "Dev Verma", r: "COO, Orbital", c: "from-[#0E7490] to-[#0E7490]" },
  { q: "gVoice became our meeting source of truth. Decisions and owners never slip through anymore.", n: "Aanya Shah", r: "Founder, Lumenly", c: "from-[#22D3EE] to-[#0E7490]" }
];

function Testimonials() {
  return (
    <section className="relative px-5 py-24 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <SectionHead eyebrow="Loved by teams" title={<>The meeting source of <span className="gv-grad-text">truth</span></>} />
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {quotes.map((q, i) => (
            <Reveal key={q.n} delay={i * 90}>
              <Glass className="gv-lift flex h-full flex-col p-6">
                <div className="flex gap-0.5 text-[var(--gv-accent)]">{Array.from({ length: 5 }).map((_, s) => <svg key={s} width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7z" /></svg>)}</div>
                <blockquote className="mt-4 flex-1 text-[15px] leading-relaxed text-[rgb(var(--gv-fg)_/_0.85)]">“{q.q}”</blockquote>
                <figcaption className="mt-5 flex items-center gap-3 border-t border-[rgb(var(--gv-fg)_/_0.1)] pt-4">
                  <span className={`grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br text-[11px] font-semibold text-white ${q.c}`}>{q.n.split(" ").map((x) => x[0]).join("")}</span>
                  <div><p className="text-[13.5px] font-medium">{q.n}</p><p className="text-[12px] text-[rgb(var(--gv-fg)_/_0.45)]">{q.r}</p></div>
                </figcaption>
              </Glass>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ════════════════════════ Security ════════════════════════ */

const security = [
  { icon: <Icon.Hash size={18} />, t: "Your own private storage", d: "Recordings and transcripts are written to your own Azure Blob Storage — you keep full custody of the data." },
  { icon: <Icon.Link size={18} />, t: "Signed, expiring access", d: "Every recording and report is served through short-lived signed URLs, never left openly accessible." },
  { icon: <Icon.Lock size={18} />, t: "Encrypted in transit & at rest", d: "All data is encrypted end-to-end by default — in motion and on disk." },
  { icon: <Icon.Users size={18} />, t: "Workspace-scoped access", d: "Authenticated sessions; meetings stay scoped to your account and team." },
  { icon: <Icon.Layers size={18} />, t: "Auditable processing", d: "Every step of the pipeline is logged per meeting, so you can trace exactly what happened." },
  { icon: <Icon.CheckCircle size={18} />, t: "SOC 2 & GDPR aligned", d: "Built to enterprise security and privacy standards, privacy-first by default." }
];

function Security() {
  return (
    <section id="security" className="relative px-5 py-24 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <SectionHead eyebrow="Enterprise ready" title={<>Security your <span className="gv-grad-text">CISO will love</span></>} subtitle="Your meetings never leave your control. gVoice stores recordings in your own cloud, behind expiring signed links, encrypted end to end." />
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {security.map((s, i) => (
            <Reveal key={s.t} delay={(i % 3) * 80}>
              <Glass ring className="gv-lift flex h-full items-start gap-3 p-5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#06B6D4]/12 text-[var(--gv-accent)]">{s.icon}</span>
                <div><h3 className="text-[15px] font-semibold">{s.t}</h3><p className="mt-1 text-[13.5px] leading-relaxed text-[var(--gv-text2)]">{s.d}</p></div>
              </Glass>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ════════════════════════ Final CTA ════════════════════════ */

function FinalCta() {
  return (
    <section className="px-5 py-24 sm:px-8 sm:py-32">
      <Reveal className="relative mx-auto max-w-5xl overflow-hidden rounded-[28px] border border-[rgb(var(--gv-fg)_/_0.1)] p-12 text-center sm:p-20">
        <div aria-hidden className="absolute inset-0 -z-10 gv-grad opacity-[0.14]" />
        <div aria-hidden className="absolute inset-0 -z-10 bg-[var(--gv-surface)]" />
        <div aria-hidden className="gv-hero-aura pointer-events-none absolute inset-0 -z-10 opacity-80" />
        <h2 className="mx-auto max-w-3xl text-[34px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[52px]">
          Stop taking notes.
          <br />
          <span className="gv-grad-text">Start driving outcomes.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-[var(--gv-text2)]">
          Let gVoice handle every meeting while your team focuses on execution.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <PrimaryBtn to="/signup" size="lg" trailing={<Icon.ArrowRight size={16} />}>Start Free</PrimaryBtn>
          <SecondaryBtn href="mailto:hello@gvoice.ai?subject=Book%20a%20gVoice%20demo&body=Hi%20gVoice%20team%2C%20I%27d%20like%20to%20book%20a%20demo.">Book Demo</SecondaryBtn>
        </div>
        <p className="mt-6 text-[12.5px] text-[rgb(var(--gv-fg)_/_0.4)]">No credit card · Works on Meet, Zoom & Teams · Report in under 2 minutes</p>
      </Reveal>
    </section>
  );
}

/* ════════════════════════ Footer ════════════════════════ */

const footerCols = [
  { title: "Product", links: ["Features", "Pricing", "Integrations", "Security"] },
  { title: "Resources", links: ["Blog", "Documentation", "Help Center"] },
  { title: "Company", links: ["About", "Careers", "Contact"] },
  { title: "Social", links: ["LinkedIn", "X", "GitHub"] }
];

function Footer() {
  return (
    <footer className="relative z-10 border-t border-[rgb(var(--gv-fg)_/_0.08)] px-5 py-16 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 md:grid-cols-[1.6fr_repeat(4,1fr)]">
          <div>
            <a href="#top" className="flex items-center">
              <BrandLogo height={28} />
            </a>
            <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-[rgb(var(--gv-fg)_/_0.45)]">The AI operating system for meetings. Every conversation becomes documentation, decisions, accountability and action — automatically.</p>
          </div>
          {footerCols.map((col) => (
            <div key={col.title}>
              <h4 className="text-[12px] font-semibold uppercase tracking-widest text-[rgb(var(--gv-fg)_/_0.4)]">{col.title}</h4>
              <ul className="mt-3 space-y-2.5">
                {col.links.map((l) => <li key={l}><a href="#top" className="text-[13.5px] text-[rgb(var(--gv-fg)_/_0.55)] transition-colors hover:text-[rgb(var(--gv-fg))]">{l}</a></li>)}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-col items-center justify-between gap-3 border-t border-[rgb(var(--gv-fg)_/_0.08)] pt-6 sm:flex-row">
          <p className="text-[12px] text-[rgb(var(--gv-fg)_/_0.3)]">© 2015–2026 Groovy Technoweb Private Limited. All rights reserved.</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11.5px] text-[rgb(var(--gv-fg)_/_0.35)]">
            <Link to="/privacy" className="transition-colors hover:text-[rgb(var(--gv-fg))]">Privacy Policy</Link>
            <Link to="/terms" className="transition-colors hover:text-[rgb(var(--gv-fg))]">Terms &amp; Conditions</Link>
            <span className="inline-flex items-center gap-1.5"><Icon.Lock size={11} className="text-[var(--gv-accent)]" /> SOC 2 ready</span>
            <span className="inline-flex items-center gap-1.5"><Icon.Check size={11} className="text-[var(--gv-accent)]" /> GDPR</span>
            <span className="inline-flex items-center gap-1.5"><Icon.Check size={11} className="text-[var(--gv-accent)]" /> Encrypted</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ════════════════════════ MoM report (real generator) ════════════════════════ */

const SAMPLE_MOM_MEETING = {
  sessionId: "sample7f3a9c21",
  meetingName: "Q3 Product Roadmap Sync",
  platform: "google_meet",
  status: "completed",
  createdAt: "2026-06-12T10:00:00.000Z",
  startedAt: "2026-06-12T10:00:00.000Z",
  endedAt: "2026-06-12T10:34:00.000Z",
  participants: [
    { name: "Maya Rao", company: "Product" },
    { name: "Jordan Kim", company: "Engineering" },
    { name: "Priya Anand", company: "QA" },
    { name: "Dev Verma", company: "Marketing" },
    { name: "Sara Lin", company: "Design" }
  ],
  actionItems: [],
  diarizedTranscript: [
    { speaker: "Maya Rao", text: "Let's lock the Q3 launch for September 14.", startTime: 42, endTime: 71 },
    { speaker: "Dev Verma", text: "I'll own the launch marketing brief.", startTime: 168, endTime: 196 },
    { speaker: "Jordan Kim", text: "Engineering can open the beta gate by Thursday.", startTime: 305, endTime: 340 },
    { speaker: "Maya Rao", text: "Target is ten design partners onboarded.", startTime: 430, endTime: 465 },
    { speaker: "Priya Anand", text: "I'll compress the QA cycle to two days.", startTime: 588, endTime: 620 },
    { speaker: "Priya Anand", text: "The QA window is tight with no buffer.", startTime: 742, endTime: 775 },
    { speaker: "Sara Lin", text: "We'll ship the one-click publish flow.", startTime: 905, endTime: 940 },
    { speaker: "Dev Verma", text: "Pricing page refresh goes out with launch.", startTime: 1098, endTime: 1130 },
    { speaker: "Maya Rao", text: "We'll run a short launch standup every morning.", startTime: 1320, endTime: 1352 }
  ],
  momReport: {
    executiveSummary:
      "<strong>Maya</strong> framed the Q3 launch and the room aligned on a <strong>September 14</strong> ship date. Marketing owns the launch brief, Engineering commits the beta gate for Thursday, and QA agreed to a compressed two-day cycle to protect the date. Design will land the one-click publish flow and Marketing will refresh pricing alongside launch. The standout risk is the tight QA window with no fallback date, plus a pricing dependency on final scope.",
    toneBreakdown: { positive: 72, neutral: 21, concerns: 7 },
    notableQuotes: [
      { text: "Let's lock the launch for September 14 — no slipping this one.", speaker: "Maya Rao", company: "Product" },
      { text: "I'll own the marketing brief and have a draft out tomorrow.", speaker: "Dev Verma", company: "Marketing" },
      { text: "Two days is tight, but I can sign off QA if scope holds.", speaker: "Priya Anand", company: "QA" },
      { text: "The one-click publish flow will save us hours every release.", speaker: "Sara Lin", company: "Design" },
      { text: "Beta gate opens Thursday — engineering is good to go.", speaker: "Jordan Kim", company: "Engineering" }
    ],
    positives: [
      { title: "Clear launch date", detail: "The team committed to September 14 with no ambiguity." },
      { title: "Ownership on every item", detail: "Each action has a named owner and a due date." },
      { title: "Risks surfaced early", detail: "The tight QA window was raised and planned for in the call." }
    ],
    concerns: [
      { title: "Tight QA window", detail: "Two-day QA cycle leaves no buffer if issues appear late." },
      { title: "Pricing depends on scope", detail: "The pricing refresh is blocked until final scope is locked." },
      { title: "No fallback date", detail: "There is no agreed backup date if the beta gate slips." }
    ],
    momSections: [
      { index: 0, tag: "Decision", topic: "Q3 launch date locked", body: "The team agreed to launch on <strong>September 14</strong> and treat it as fixed." },
      { index: 1, tag: "Task", topic: "Marketing brief ownership", body: "Dev will own the launch marketing brief, with a first draft the next day." },
      { index: 2, tag: "Task", topic: "Beta gate", body: "Engineering will open the beta gate by Thursday, September 11." },
      { index: 3, tag: "Goal", topic: "Design-partner target", body: "Aim for ten design partners onboarded before general availability." },
      { index: 4, tag: "Task", topic: "QA cycle compression", body: "QA will run a compressed two-day cycle to protect the launch date." },
      { index: 5, tag: "Concern", topic: "Tight QA window", body: "The compressed window leaves no buffer for late-breaking defects." },
      { index: 6, tag: "Decision", topic: "One-click publish flow", body: "Design and Engineering will ship a single-button publish flow." },
      { index: 7, tag: "Task", topic: "Pricing page refresh", body: "Marketing will refresh the pricing page to ship alongside launch." },
      { index: 8, tag: "Decision", topic: "Daily launch standup", body: "A short daily launch standup will run through the launch window." }
    ],
    actionItems: [
      { task: "Ship the launch marketing brief", detail: "Draft, review and publish the Q3 launch brief.", owners: ["Dev Verma"], due: "Sep 13", priority: "high", status: "in_progress" },
      { task: "Open the engineering beta gate", detail: "Enable the beta gate for design partners.", owners: ["Jordan Kim"], due: "Sep 11", priority: "high", status: "open" },
      { task: "Run and sign off the QA cycle", detail: "Execute the compressed two-day QA pass.", owners: ["Priya Anand"], due: "Sep 12", priority: "high", status: "planned" },
      { task: "Onboard ten design partners", detail: "Confirm and onboard the launch design partners.", owners: ["Maya Rao", "Dev Verma"], due: "Sep 13", priority: "medium", status: "in_progress" },
      { task: "Ship the one-click publish flow", detail: "Build and verify the single-button publish action.", owners: ["Sara Lin"], due: "Sep 12", priority: "medium", status: "planned" },
      { task: "Refresh the pricing page", detail: "Update pricing copy and layout for launch.", owners: ["Dev Verma"], due: "Sep 14", priority: "medium", status: "planned" },
      { task: "Set up the daily launch standup", detail: "Create the recurring 15-minute launch standup.", owners: ["Maya Rao"], due: "Sep 10", priority: "low", status: "open" }
    ],
    topTodos: [
      { title: "Beta gate", detail: "Open the engineering beta gate for design partners.", owner: "Jordan Kim", priority: "critical", due: "Sep 11" },
      { title: "QA sign-off", detail: "Run and sign off the compressed two-day QA cycle.", owner: "Priya Anand", priority: "critical", due: "Sep 12" },
      { title: "Marketing brief", detail: "Finish and circulate the launch brief.", owner: "Dev Verma", priority: "high", due: "Sep 13" },
      { title: "Publish flow", detail: "Land the one-click publish flow.", owner: "Sara Lin", priority: "high", due: "Sep 12" },
      { title: "Pricing refresh", detail: "Update the pricing page for launch.", owner: "Dev Verma", priority: "medium", due: "Sep 14" }
    ],
    risks: [
      { severity: "red", title: "No QA buffer", detail: "A two-day QA cycle with no slack risks shipping late defects.", owner: "Priya Anand" },
      { severity: "amber", title: "Pricing depends on scope", detail: "The pricing refresh is blocked until final scope is locked.", owner: "Dev Verma" },
      { severity: "amber", title: "No fallback date", detail: "There is no agreed backup launch date if the beta gate slips.", owner: "Maya Rao" }
    ],
    nextSteps: [
      { period: "Today", title: "Open beta gate", detail: "Engineering enables the beta gate for design partners." },
      { period: "Thu", title: "QA cycle", detail: "Run the compressed two-day QA pass and sign off." },
      { period: "Fri", title: "Marketing brief", detail: "Publish the launch brief and circulate for review." },
      { period: "Fri", title: "Publish flow", detail: "Verify the one-click publish flow end-to-end." },
      { period: "Sat", title: "Launch", detail: "Ship Q3 on September 14 with the daily standup running." }
    ],
    attendees: [
      { name: "Maya Rao", role: "Product Lead" },
      { name: "Jordan Kim", role: "Engineering Lead" },
      { name: "Priya Anand", role: "QA Lead" },
      { name: "Dev Verma", role: "Marketing" },
      { name: "Sara Lin", role: "Design Lead" }
    ],
    generatedAt: "2026-06-12T10:36:00.000Z",
    source: "ai"
  }
} as unknown as Meeting;

const SAMPLE_MOM_HTML = buildMomHtml(SAMPLE_MOM_MEETING);
const SAMPLE_MOM_URL = URL.createObjectURL(new Blob([SAMPLE_MOM_HTML], { type: "text/html" }));

// Renders the sample report and keeps its internal theme in sync with the
// landing page theme (it's a same-origin blob iframe, so we can set data-theme
// on its document directly — dark report in dark mode, light in light).
function ReportFrame({ className, style, scrolling, tabIndex, ariaHidden, title }: { className?: string; style?: CSSProperties; scrolling?: "no" | "yes" | "auto"; tabIndex?: number; ariaHidden?: boolean; title: string }) {
  const { theme } = useTheme();
  const ref = useRef<HTMLIFrameElement>(null);
  const sync = () => {
    const doc = ref.current?.contentDocument;
    if (doc?.documentElement) {
      doc.documentElement.setAttribute("data-theme", theme);
      try {
        doc.defaultView?.localStorage.setItem("gv-mom-theme", theme);
      } catch {
        /* ignore */
      }
    }
  };
  useEffect(sync, [theme]);
  return (
    <iframe
      ref={ref}
      src={SAMPLE_MOM_URL}
      title={title}
      tabIndex={tabIndex}
      aria-hidden={ariaHidden}
      scrolling={scrolling}
      onLoad={sync}
      className={className}
      style={style}
    />
  );
}

function MomModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--gv-scrim)] p-3 sm:p-6 animate-[gvFade_.2s_ease]" onClick={onClose}>
      <div
        className="gv-card-ring relative flex max-h-[94vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-2xl border border-[rgb(var(--gv-fg)_/_0.12)] bg-[var(--gv-surface)] shadow-[0_40px_120px_-30px_rgba(34,211,238,0.45),0_30px_80px_-40px_rgba(0,0,0,0.9)] animate-[gvPop_.28s_cubic-bezier(.22,1,.36,1)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative flex items-center justify-between gap-3 border-b border-[rgb(var(--gv-fg)_/_0.1)] bg-[rgb(var(--gv-fg)_/_0.02)] px-5 py-3.5">
          <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#06B6D4]/60 to-transparent" />
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl gv-grad text-white shadow-[0_8px_24px_-8px_rgba(34,211,238,0.85)]"><Icon.Download size={16} /></span>
            <div className="leading-tight">
              <p className="text-[14.5px] font-semibold text-[rgb(var(--gv-fg))]">Sample meeting report</p>
              <p className="text-[11.5px] text-[rgb(var(--gv-fg)_/_0.45)]">The exact HTML report gVoice generates for every meeting</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <button onClick={downloadMom} className="group relative inline-flex h-9 items-center gap-2 overflow-hidden rounded-lg gv-cta px-4 text-[13px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(34,211,238,0.8)] transition-transform hover:-translate-y-0.5 focus-ring">
              <span aria-hidden className="gv-sheen pointer-events-none absolute inset-0" />
              <span className="relative inline-flex items-center gap-1.5"><Icon.Download size={14} /> Download report</span>
            </button>
            <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg border border-[rgb(var(--gv-fg)_/_0.1)] text-[rgb(var(--gv-fg)_/_0.6)] transition-colors hover:bg-[rgb(var(--gv-fg)_/_0.1)] hover:text-[rgb(var(--gv-fg))] focus-ring" aria-label="Close"><Icon.Close size={16} /></button>
          </div>
        </div>
        <ReportFrame title="Sample meeting report" className="h-[82vh] w-full border-0 bg-[var(--gv-bg)]" />
      </div>
    </div>
  );
}

function downloadMom() {
  const url = URL.createObjectURL(new Blob([SAMPLE_MOM_HTML], { type: "text/html" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "gVoice-Q3-Roadmap-Sync-Report.html";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ════════════════════════ Scoped styles ════════════════════════ */

function GVStyles() {
  return (
    <style>{`
      html { scroll-behavior: smooth; scroll-padding-top: 5rem; }

      /* Theme tokens — dark by default, flipped to light when html is NOT .dark.
       * --gv-fg is an RGB triplet so every former white/α utility (now
       * rgb(var(--gv-fg)/α)) flips between light-on-dark and dark-on-light. */
      .gv {
        --gv-fg: 255 255 255;
        --gv-bg: #09090c;
        --gv-bg-strong: rgba(9, 9, 12, 0.8);
        --gv-scrim: rgba(9, 9, 12, 0.85);
        --gv-surface: #121319;
        --gv-text2: #A8B3CF;
        --gv-accent: #06B6D4;
        --gv-grid-line: rgba(255, 255, 255, 0.09);
        --gv-amb: 0.65;
        --gv-glass: rgba(255, 255, 255, 0.07);
        --gv-glass-line: rgba(255, 255, 255, 0.08);
      }
      html:not(.dark) .gv {
        --gv-fg: 15 23 42;
        --gv-bg: #F3F6FC;
        --gv-bg-strong: rgba(243, 246, 252, 0.82);
        --gv-scrim: rgba(15, 23, 42, 0.45);
        --gv-surface: #FFFFFF;
        --gv-text2: #475569;
        --gv-accent: #0891B2;
        --gv-grid-line: rgba(15, 23, 42, 0.22);
        --gv-amb: 0.32;
        --gv-glass: rgba(255, 255, 255, 0.8);
        --gv-glass-line: rgba(15, 23, 42, 0.08);
      }

      .gv-grad { background-image: linear-gradient(135deg, #06B6D4 0%, #22D3EE 45%, #0E7490 100%); }
      .gv-cta { background-image: linear-gradient(90deg, #06B6D4, #22D3EE); }
      .gv-grad-text { background-image: linear-gradient(135deg, #06B6D4, #22D3EE 45%, #0E7490); -webkit-background-clip: text; background-clip: text; color: transparent; }

      /* No live backdrop-filter on this page: it re-blurs the scrolling backdrop
         every frame and was the remaining scroll-jank source (measured). The
         frosted look is kept via translucent bg + border + shadow. */
      [class*="backdrop-blur"] { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
      .gv-glass { background: var(--gv-glass); border: 1px solid var(--gv-glass-line); box-shadow: 0 1px 0 0 rgba(255,255,255,0.05) inset, 0 24px 60px -28px rgba(0,0,0,0.18); }
      .gv-glow { box-shadow: 0 1px 0 0 rgba(255,255,255,0.06) inset, 0 30px 80px -30px rgba(34,211,238,0.35), 0 20px 50px -30px rgba(0,0,0,0.9); }
      .gv-card-ring::before { content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none; background: linear-gradient(140deg, rgba(6,182,212,0.6), rgba(34,211,238,0.3) 45%, rgba(14,116,144,0.55)); -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; opacity: 0.55; transition: opacity .3s; }
      .gv-card-ring:hover::before { opacity: 0.95; }
      .gv-ring::before { content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none; background: linear-gradient(135deg, rgba(6,182,212,0.7), rgba(34,211,238,0.35) 45%, rgba(14,116,144,0.7)); -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; opacity: 0.55; }

      .gv-lift { transition: transform .25s cubic-bezier(.22,1,.36,1), border-color .25s; }
      .gv-lift:hover { transform: translateY(-3px); border-color: rgba(255,255,255,0.14); }

      /* Atmosphere */
      .gv-atmos { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
      .gv-orb { position: absolute; border-radius: 50%; will-change: transform; opacity: var(--gv-amb, 0.7); }
      .gv-grid { background-image: radial-gradient(var(--gv-grid-line) 1.4px, transparent 1.5px); background-size: 24px 24px; mask-image: radial-gradient(130% 85% at 50% 0%, #000 0%, transparent 65%); -webkit-mask-image: radial-gradient(130% 85% at 50% 0%, #000 0%, transparent 65%); }
      .gv-noise { opacity: 0.05; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>"); }
      .gv-hero-aura { opacity: var(--gv-amb, 0.7); background: radial-gradient(circle at 15% 20%, rgba(6,182,212,.16), transparent 42%), radial-gradient(circle at 85% 30%, rgba(34,211,238,.12), transparent 44%), radial-gradient(circle at 50% 85%, rgba(14,116,144,.10), transparent 46%); }

      @keyframes gvDrift { 0%,100% { transform: translate3d(0,0,0); } 50% { transform: translate3d(40px,-34px,0); } }
      /* Orb drift disabled: animating these large gradient layers repaints the
         page every frame and was the measured #1 scroll-jank cause. The slow
         wander was imperceptible; orbs stay static. */
      .gv-drift, .gv-drift-slow { animation: none; }

      .gv-parallax { transform: translate3d(calc(var(--px,0) * var(--depth)), calc(var(--py,0) * var(--depth)), 0); transition: transform .35s ease-out; will-change: transform; }
      .gv-floaty { animation: gvFloat 7s ease-in-out infinite; will-change: transform; }
      @keyframes gvFloat { 0%,100% { transform: translateY(0) rotate(-.6deg); } 50% { transform: translateY(-12px) rotate(.6deg); } }

      .gv-tilt { perspective: 1000px; }
      .gv-tilt-inner { transform: rotateX(var(--rx,0)) rotateY(var(--ry,0)); transition: transform .25s ease-out; transform-style: preserve-3d; }

      .gv-flow { animation: gvDash 1.6s linear infinite; }
      @keyframes gvDash { to { stroke-dashoffset: -22; } }

      .gv-sheen { background: linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.5) 50%, transparent 70%); background-size: 220% 100%; animation: gvSheen 4.5s ease-in-out infinite; }
      @keyframes gvSheen { 0%,60% { background-position: 150% 0; } 100% { background-position: -50% 0; } }

      .gv-reveal { opacity: 0; transform: translateY(18px); transition: opacity .6s cubic-bezier(.22,1,.36,1), transform .6s cubic-bezier(.22,1,.36,1); }
      .gv-in { opacity: 1; transform: none; }

      @keyframes gvWordIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      @keyframes gvFade { from { opacity: 0; } to { opacity: 1; } }
      @keyframes gvPop { from { opacity: 0; transform: scale(0.97) translateY(10px); } to { opacity: 1; transform: none; } }

      .gv-stagger > * { opacity: 0; animation: gvUp .6s cubic-bezier(.22,1,.36,1) forwards; }
      .gv-stagger > *:nth-child(1){animation-delay:.05s}.gv-stagger > *:nth-child(2){animation-delay:.12s}.gv-stagger > *:nth-child(3){animation-delay:.19s}.gv-stagger > *:nth-child(4){animation-delay:.26s}.gv-stagger > *:nth-child(5){animation-delay:.33s}.gv-stagger > *:nth-child(6){animation-delay:.4s}
      @keyframes gvUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

      @media (prefers-reduced-motion: reduce) {
        .gv-reveal { opacity: 1 !important; transform: none !important; transition: none !important; }
        .gv-drift, .gv-drift-slow, .gv-floaty, .gv-flow, .gv-sheen, .gv-stagger > * { animation: none !important; opacity: 1 !important; }
        .gv-parallax { transform: none !important; }
      }
    `}</style>
  );
}

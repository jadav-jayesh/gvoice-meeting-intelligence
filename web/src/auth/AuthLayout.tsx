import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BrandLogo } from "../components/BrandLogo";
import { Icon } from "../components/Icon";
import { ThemeToggle } from "../theme/ThemeToggle";

interface Props {
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}

const heroStats: Array<{ label: string; value: string }> = [
  { value: "12.4k", label: "Meetings transcribed" },
  { value: "98%", label: "Speaker accuracy" },
  { value: "<2m", label: "Time-to-summary" }
];

export function AuthLayout({ title, subtitle, children, footer }: Props) {
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-bg text-ink">
      <BackdropOrbs />

      {/* Theme toggle — fixed to the viewport corner so it's reachable on both
       * the wide split-layout and the single-column mobile view. */}
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6 z-20">
        <ThemeToggle />
      </div>

      <div className="relative z-10 min-h-screen w-full flex flex-col">
        {/* Marketing panel removed from the auth pages — a centered form only, so
            login/signup never scroll. Kept defined (rendered hidden) for reuse. */}
        <HeroPanel />

        <main className="relative flex flex-1 items-center justify-center px-5 sm:px-8 py-10 lg:py-14 overflow-hidden">
          {/* Stage lighting for the form — soft colored orbs in three corners
           * and a faint dot grid that gives the empty space some texture. */}
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {/* Top-right brand wash */}
            <div
              className="absolute -top-32 -right-24 w-[520px] h-[520px] rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgb(6 182 212 / 0.18), transparent 70%)",
                filter: "blur(70px)"
              }}
            />
            {/* Bottom-left cool counter-wash */}
            <div
              className="absolute -bottom-40 -left-20 w-[480px] h-[480px] rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgb(34 211 238 / 0.16), transparent 70%)",
                filter: "blur(80px)"
              }}
            />
            {/* Mid teal accent for chromatic interest */}
            <div
              className="absolute top-1/2 -right-40 -translate-y-1/2 w-[360px] h-[360px] rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgb(8 145 178 / 0.14), transparent 70%)",
                filter: "blur(60px)"
              }}
            />
            {/* Faint dot pattern, masked to a vertical band so it concentrates
             * around the form and fades to the edges */}
            <div
              className="absolute inset-0"
              style={{
                backgroundImage:
                  "radial-gradient(rgb(255 255 255 / 0.07) 1px, transparent 1px)",
                backgroundSize: "22px 22px",
                maskImage:
                  "radial-gradient(ellipse 60% 80% at 50% 50%, #000 30%, transparent 80%)",
                WebkitMaskImage:
                  "radial-gradient(ellipse 60% 80% at 50% 50%, #000 30%, transparent 80%)"
              }}
            />
            {/* Subtle film-grain to defeat banding on big gradients */}
            <div className="absolute inset-0 noise" />
          </div>

          <div className="relative w-full max-w-[440px] animate-[fadeUp_0.5s_cubic-bezier(0.22,1,0.36,1)_both]">
            <div className="mb-8 flex justify-center">
              <Link to="/" aria-label="gVoice home" className="focus-ring rounded-lg">
                <BrandLogo height={28} />
              </Link>
            </div>

            <FormShell title={title} subtitle={subtitle}>
              {children}
            </FormShell>

            <p className="mt-6 text-center text-[13px] text-inkSoft">{footer}</p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[11px] text-inkFaint">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <ShieldIcon />
                256-bit encryption
              </span>
              <span className="w-1 h-1 rounded-full bg-inkFaint/40" />
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <Icon.Bolt size={11} />
                SOC 2 Type II
              </span>
              <span className="w-1 h-1 rounded-full bg-inkFaint/40" />
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <Icon.Check size={11} />
                GDPR ready
              </span>
            </div>
          </div>
        </main>
      </div>

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: none; }
        }
      `}</style>
    </div>
  );
}

function FormShell({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="relative">
      {/* Vivid colored halo bleeding out from behind the card */}
      <div aria-hidden className="absolute -inset-16 glow-halo opacity-90 pointer-events-none" />
      {/* Outer ring of light — wider, softer, gives the card a "spotlit" feel */}
      <div
        aria-hidden
        className="absolute -inset-24 rounded-[40px] pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 50%, rgb(6 182 212 / 0.10), transparent 70%)",
          filter: "blur(40px)"
        }}
      />

      <div className="relative glass-card rounded-2xl p-7 sm:p-8 overflow-hidden">
        {/* Bright top edge — fakes the look of a lit polished panel */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent dark:via-white/40"
        />
        {/* Brand-tinted corner accent (top-left) for depth */}
        <span
          aria-hidden
          className="pointer-events-none absolute -top-24 -left-24 w-48 h-48 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgb(6 182 212 / 0.18), transparent 70%)",
            filter: "blur(20px)"
          }}
        />
        {/* Subtle counter-accent (bottom-right) — cooler tone for contrast */}
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -right-24 w-56 h-56 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgb(34 211 238 / 0.14), transparent 70%)",
            filter: "blur(24px)"
          }}
        />
        {/* Subtle noise texture for premium feel */}
        <span aria-hidden className="pointer-events-none absolute inset-0 noise rounded-2xl" />

        <div className="relative">
          {/* Brand glyph anchors the card visually when the hero panel is
           * hidden (mobile) and gives the form an identity on desktop too. */}
          <span className="flex items-center justify-center w-10 h-10 rounded-xl mb-4 bg-gradient-to-br from-brand-500 via-brand-400 to-brand-700 text-white shadow-pop">
            <Icon.Wave size={17} />
          </span>
          <h1 className="text-[24px] sm:text-[26px] font-semibold tracking-tighter2 text-ink leading-tight">
            {title}
          </h1>
          <p className="mt-1.5 text-[13.5px] text-inkSoft leading-relaxed">{subtitle}</p>
        </div>

        <div className="relative mt-7">{children}</div>
      </div>
    </div>
  );
}

function HeroPanel() {
  return (
    <aside className="hidden relative overflow-hidden border-r border-line">
      {/* Layered backdrop */}
      <div aria-hidden className="absolute inset-0 surface-feature" />
      <div aria-hidden className="absolute inset-0 hero-grid opacity-60" />
      <div aria-hidden className="absolute inset-0 noise pointer-events-none" />

      {/* Aurora ribbon up top — slow rotation, subtle wash */}
      <div
        aria-hidden
        className="absolute -top-1/3 left-1/2 -translate-x-1/2 w-[140%] aspect-square animate-aurora aurora opacity-30 pointer-events-none"
      />

      <div
        aria-hidden
        className="absolute -bottom-40 -right-24 w-[520px] h-[520px] rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgb(34 211 238 / 0.28), transparent 70%)", filter: "blur(80px)" }}
      />

      {/* One centered column so the panel never reads as half-empty on very
       * wide screens — logo, pitch, preview and proof all share one measure. */}
      <div className="relative z-10 flex flex-col justify-between gap-10 w-full max-w-[680px] mx-auto p-10 xl:px-12 xl:py-11">
        {/* Top: brand */}
        <div className="flex items-center">
          <BrandLogo height={30} />
        </div>

        {/* Middle: pitch → how it works → live preview */}
        <div className="flex flex-col gap-8">
          <div>
            <span className="inline-flex items-center gap-1.5 px-2.5 h-6 rounded-full bg-brand-500/10 border border-brand-500/25 text-brand-500 dark:text-brand-400 text-[11px] font-medium tracking-wide uppercase mb-5">
              <Icon.Sparkles size={11} />
              Meeting intelligence
            </span>
            <h2 className="text-[40px] xl:text-[50px] font-semibold tracking-tighter2 leading-[1.04] text-ink">
              Every meeting,
              <br />
              <span className="text-gradient-brand">turned into action.</span>
            </h2>
            <p className="mt-4 text-[15px] text-inkSoft leading-relaxed max-w-[500px]">
              gVoice silently joins your calls and, the moment they end, hands you the full
              write-up — minutes, summary and owned action items. No editing, no follow-ups.
            </p>
          </div>

          <HowItWorks />

          <ProductPreview />
        </div>

        {/* Bottom: trusted-by + stat row */}
        <div className="space-y-5">
          <TrustedByStrip />
          <div className="flex items-center gap-6">
            {heroStats.map((s, i) => (
              <div key={s.label} className="flex items-center gap-6">
                {i > 0 && <span aria-hidden className="w-px h-9 bg-line" />}
                <div>
                  <p className="text-[22px] font-semibold text-ink tracking-tight tabular-nums">{s.value}</p>
                  <p className="text-[10.5px] uppercase tracking-widest text-inkFaint mt-0.5">{s.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

// The product story in three beats. Numbered steps with arrows read at a
// glance — much faster to grasp than abstract feature chips.
const howItWorksSteps = [
  { icon: <Icon.Video size={14} />, title: "Joins the call", detail: "Meet · Teams · Zoom" },
  { icon: <Icon.Wave size={14} />, title: "Live transcript", detail: "Speakers & tone" },
  { icon: <Icon.CheckCircle size={14} />, title: "MoM & actions", detail: "Ready in <2 min" }
];

function HowItWorks() {
  return (
    <ol className="flex items-stretch gap-2" aria-label="How gVoice works">
      {howItWorksSteps.map((step, i) => (
        <li key={step.title} className="flex-1 min-w-0 flex items-center gap-2">
          {i > 0 && <Icon.ArrowRight size={13} className="text-inkFaint shrink-0" aria-hidden />}
          <div className="flex-1 min-w-0 h-full rounded-xl border border-line bg-surface/55 backdrop-blur px-3 py-3 flex items-center gap-2.5">
            <span className="relative inline-flex items-center justify-center w-8 h-8 rounded-lg bg-brand-500/10 text-brand-500 dark:text-brand-400 shrink-0">
              {step.icon}
              <span className="absolute -top-1.5 -left-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-brand-500 text-white text-[9px] font-semibold">
                {i + 1}
              </span>
            </span>
            {/* Wrap instead of truncate — at narrower widths the copy folds to
             * a second line and stays readable. */}
            <span className="min-w-0">
              <span className="block text-[12.5px] font-medium text-ink leading-tight">
                {step.title}
              </span>
              <span className="block text-[11px] text-inkMute leading-tight mt-0.5">
                {step.detail}
              </span>
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ProductPreview() {
  return (
    <div className="relative">
      {/* Halo under the floating stack */}
      <div
        aria-hidden
        className="absolute -inset-8 rounded-3xl pointer-events-none"
        style={{
          background:
            "radial-gradient(70% 60% at 45% 50%, rgb(6 182 212 / 0.26), transparent 70%)",
          filter: "blur(40px)"
        }}
      />

      <div className="relative flex items-stretch gap-4">
        {/* Primary card: the meeting while it happens */}
        <div className="relative glass-card rounded-2xl p-5 flex-1 min-w-0 animate-float-y">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-brand-500/15 text-brand-500 dark:text-brand-400">
            <Icon.Video size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-ink truncate">Q3 Roadmap Sync</p>
            <p className="text-[11px] text-inkMute">Google Meet · 32 min</p>
          </div>
          <span className="inline-flex items-center gap-1 px-2 h-5 rounded-full bg-positive/15 text-positive text-[10.5px] font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-positive animate-pulse" />
            Live
          </span>
        </div>

        <div className="mt-4 space-y-3">
          <TranscriptLine
            initials="MR"
            name="Maya R."
            text="Let's lock in the launch date — I'll own the marketing brief."
            tone="from-brand-500 to-brand-600"
          />
          <TranscriptLine
            initials="JK"
            name="Jordan K."
            text="Engineering can ship the beta gate by next Thursday."
            tone="from-sky-500 to-indigo-500"
          />
          <TranscriptLine
            initials="AI"
            name="gVoice"
            text="Action item captured · 2 owners · due Sep 14"
            tone="from-brand-500 to-brand-700"
            ai
          />
        </div>

        <div className="mt-4 pt-4 border-t border-line flex items-center justify-between">
          <span className="text-[11px] text-inkMute">Sentiment trending up</span>
          <SparklineSvg />
        </div>
        </div>

        {/* Side rail: what lands in your inbox after the call. A separate
         * column on purpose — every line stays fully readable instead of
         * being clipped behind the transcript card. */}
        <div className="hidden xl:flex w-[212px] shrink-0 flex-col gap-3">
          <p className="pl-1 text-[10px] uppercase tracking-widest text-inkFaint">
            After the call
          </p>

          <div
            className="glass-card rounded-xl p-3.5 rotate-[1.25deg] animate-float-y"
            style={{ animationDelay: "0.6s" }}
          >
            <div className="flex items-center justify-between">
              <p className="text-[10.5px] uppercase tracking-widest text-inkFaint">Action items</p>
              <span className="text-[10.5px] text-positive font-medium">+3 new</span>
            </div>
            <ul className="mt-2 space-y-1.5">
              {[
                { who: "Maya", text: "Ship marketing brief" },
                { who: "Jordan", text: "Open beta gate" },
                { who: "Alex", text: "Customer call" }
              ].map((item) => (
                <li key={item.text} className="flex items-center gap-2 text-[11px]">
                  <span className="w-3 h-3 rounded-[3px] border border-brand-500/50 bg-brand-500/15 flex items-center justify-center shrink-0">
                    <svg width="7" height="7" viewBox="0 0 10 10" fill="none" aria-hidden>
                      <path d="M2 5l2 2 4 -4" stroke="#06b6d4" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="text-inkSoft truncate">
                    <span className="text-inkMute">{item.who} · </span>
                    {item.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div
            className="glass-card rounded-xl px-3.5 py-2.5 flex items-center gap-2.5 shadow-pop -rotate-[1.25deg] animate-float-y"
            style={{ animationDelay: "1.1s" }}
          >
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-brand-500/20 text-brand-500 dark:text-brand-400 shrink-0">
              <Icon.CheckCircle size={14} />
            </span>
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-ink leading-tight">Summary ready</p>
              <p className="text-[10.5px] text-inkMute">4 decisions · 7 todos</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrustedByStrip() {
  // Abstract pseudo-logos — generic enough to feel like brand marks without
  // pretending to be a specific company.
  const marks = [
    { name: "Northwind" },
    { name: "Helix Labs" },
    { name: "Orbital" },
    { name: "Lumenly" }
  ];
  return (
    <div className="flex items-center gap-6">
      <p className="text-[10.5px] uppercase tracking-widest text-inkFaint shrink-0">
        Trusted by teams at
      </p>
      <div className="flex items-center gap-5 flex-wrap text-inkMute">
        {marks.map((m) => (
          <span key={m.name} className="flex items-center gap-1.5 text-[12.5px] font-medium opacity-70">
            <BrandMark />
            {m.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function BrandMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 13l3 3 7 -7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TranscriptLine({
  initials,
  name,
  text,
  tone,
  ai
}: {
  initials: string;
  name: string;
  text: string;
  tone: string;
  ai?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-[10px] font-semibold shrink-0 bg-gradient-to-br ${tone}`}
        style={{ boxShadow: "inset 0 1px 0 0 rgb(255 255 255 / 0.2)" }}
      >
        {initials}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-inkMute flex items-center gap-1.5">
          {name}
          {ai && (
            <span className="inline-flex items-center gap-1 text-brand-500 dark:text-brand-400">
              <Icon.Sparkles size={10} />
            </span>
          )}
        </p>
        <p className={`text-[12.5px] leading-snug mt-0.5 ${ai ? "text-brand-500 dark:text-brand-400 font-medium" : "text-inkSoft"}`}>
          {text}
        </p>
      </div>
    </div>
  );
}

function SparklineSvg() {
  return (
    <svg width="84" height="22" viewBox="0 0 84 22" fill="none" aria-hidden>
      <defs>
        <linearGradient id="auth-spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M2 16 L14 13 L24 15 L34 9 L46 11 L58 6 L70 7 L82 2"
        stroke="#06b6d4"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M2 16 L14 13 L24 15 L34 9 L46 11 L58 6 L70 7 L82 2 L82 22 L2 22 Z"
        fill="url(#auth-spark)"
      />
    </svg>
  );
}

function BackdropOrbs() {
  return (
    <>
      <div
        aria-hidden
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[1200px] h-[600px] pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 0%, rgb(6 182 212 / 0.10), transparent 70%)",
          filter: "blur(60px)"
        }}
      />
      <div
        aria-hidden
        className="absolute bottom-0 right-0 w-[700px] h-[500px] pointer-events-none"
        style={{
          background:
            "radial-gradient(50% 50% at 100% 100%, rgb(34 211 238 / 0.10), transparent 70%)",
          filter: "blur(80px)"
        }}
      />
    </>
  );
}

function ShieldIcon() {
  return (
    <svg
      width={11}
      height={11}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3l8 3v6c0 5 -3.5 8 -8 9c-4.5 -1 -8 -4 -8 -9V6z" />
      <path d="M9 12l2 2 4 -4" />
    </svg>
  );
}

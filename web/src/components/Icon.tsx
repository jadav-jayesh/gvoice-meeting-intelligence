import type { SVGProps } from "react";

// Lightweight icon set tuned to a 1.75 stroke, 24×24 grid. Centralised so every
// page renders the same visual family.
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base(props: IconProps) {
  const { size = 16, className, ...rest } = props;
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    ...rest
  };
}

export const Icon = {
  Dashboard: (p: IconProps) => (
    <svg {...base(p)}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  Meetings: (p: IconProps) => (
    <svg {...base(p)}>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5 -3v10l-5 -3z" />
    </svg>
  ),
  Insights: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M3 17l5 -5 4 4 8 -8" />
      <path d="M14 8h6v6" />
    </svg>
  ),
  Search: (p: IconProps) => (
    <svg {...base(p)}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5 -3.5" />
    </svg>
  ),
  Play: (p: IconProps) => (
    <svg {...base(p)} fill="currentColor" strokeWidth={0}>
      <path d="M7 4l13 8 -13 8z" />
    </svg>
  ),
  Pause: (p: IconProps) => (
    <svg {...base(p)} fill="currentColor" strokeWidth={0}>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  ),
  Sparkles: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.5 5.5l2.8 2.8M15.7 15.7l2.8 2.8M5.5 18.5l2.8 -2.8M15.7 8.3l2.8 -2.8" />
    </svg>
  ),
  Wave: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 12h2" />
    </svg>
  ),
  Users: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M16 19v-2a4 4 0 0 0 -4 -4H6a4 4 0 0 0 -4 4v2" />
      <circle cx="9" cy="7" r="3.5" />
      <path d="M22 19v-2a4 4 0 0 0 -3 -3.9" />
      <path d="M16 4a4 4 0 0 1 0 7" />
    </svg>
  ),
  Check: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M5 12l4 4L19 6" />
    </svg>
  ),
  CheckCircle: (p: IconProps) => (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12l3 3 5 -6" />
    </svg>
  ),
  AlertCircle: (p: IconProps) => (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <circle cx="12" cy="16" r="0.5" fill="currentColor" />
    </svg>
  ),
  Clock: (p: IconProps) => (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  Calendar: (p: IconProps) => (
    <svg {...base(p)}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  ),
  ArrowRight: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M5 12h14M13 6l6 6 -6 6" />
    </svg>
  ),
  ArrowUp: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M12 19V5M6 11l6 -6 6 6" />
    </svg>
  ),
  ArrowDown: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M12 5v14M6 13l6 6 6 -6" />
    </svg>
  ),
  ChevronLeft: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  ),
  ChevronRight: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M9 6l6 6 -6 6" />
    </svg>
  ),
  ChevronDown: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M6 9l6 6 6 -6" />
    </svg>
  ),
  Close: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M6 6l12 12M18 6l-12 12" />
    </svg>
  ),
  Link: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M10 13a5 5 0 0 0 7.54 0.54l3 -3a5 5 0 0 0 -7.07 -7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0 -7.54 -0.54l-3 3a5 5 0 0 0 7.07 7.07l1.71 -1.71" />
    </svg>
  ),
  Download: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M21 15v4a2 2 0 0 1 -2 2H5a2 2 0 0 1 -2 -2v-4" />
      <path d="M7 10l5 5 5 -5" />
      <path d="M12 15V3" />
    </svg>
  ),
  Video: (p: IconProps) => (
    <svg {...base(p)}>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5 -3v10l-5 -3z" />
    </svg>
  ),
  Copy: (p: IconProps) => (
    <svg {...base(p)}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1 -2 -2V4a2 2 0 0 1 2 -2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  Bolt: (p: IconProps) => (
    <svg {...base(p)} fill="currentColor" strokeWidth={0}>
      <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
    </svg>
  ),
  Brain: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M8 5a3 3 0 0 0 -3 3v1.5a3 3 0 0 0 -2 2.8v0a3 3 0 0 0 2 2.8V17a3 3 0 0 0 3 3h1V5z" />
      <path d="M16 5a3 3 0 0 1 3 3v1.5a3 3 0 0 1 2 2.8v0a3 3 0 0 1 -2 2.8V17a3 3 0 0 1 -3 3h-1V5z" />
    </svg>
  ),
  Mic: (p: IconProps) => (
    <svg {...base(p)}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  ),
  Filter: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M3 5h18l-7 9v5l-4 -2v-3z" />
    </svg>
  ),
  Plus: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  Command: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M9 6a3 3 0 1 0 -3 3h12a3 3 0 1 0 -3 -3v12a3 3 0 1 0 3 -3H6a3 3 0 1 0 3 3z" />
    </svg>
  ),
  Cog: (p: IconProps) => (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06 .07a2 2 0 1 1 -2.83 2.83l-.07 -.06a1.7 1.7 0 0 0 -1.87 -.34a1.7 1.7 0 0 0 -1 1.51v.2a2 2 0 1 1 -4 0v-.1a1.7 1.7 0 0 0 -1.1 -1.55a1.7 1.7 0 0 0 -1.87 .34l-.07 .06a2 2 0 1 1 -2.83 -2.83l.06 -.07a1.7 1.7 0 0 0 .34 -1.87a1.7 1.7 0 0 0 -1.51 -1H3a2 2 0 1 1 0 -4h.1a1.7 1.7 0 0 0 1.55 -1.1a1.7 1.7 0 0 0 -.34 -1.87l-.06 -.07a2 2 0 1 1 2.83 -2.83l.07 .06a1.7 1.7 0 0 0 1.87 .34H9a1.7 1.7 0 0 0 1 -1.51V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.51a1.7 1.7 0 0 0 1.87 -.34l.07 -.06a2 2 0 1 1 2.83 2.83l-.06 .07a1.7 1.7 0 0 0 -.34 1.87V9a1.7 1.7 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0 -1.51 1z" />
    </svg>
  ),
  Trend: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M3 17l6 -6 4 4 8 -10" />
      <path d="M14 5h7v7" />
    </svg>
  ),
  Quote: (p: IconProps) => (
    <svg {...base(p)} fill="currentColor" strokeWidth={0}>
      <path d="M9 7H5a2 2 0 0 0 -2 2v4a2 2 0 0 0 2 2h2v2a4 4 0 0 1 -4 4v2c4.4 0 8 -3.6 8 -8z" />
      <path d="M21 7h-4a2 2 0 0 0 -2 2v4a2 2 0 0 0 2 2h2v2a4 4 0 0 1 -4 4v2c4.4 0 8 -3.6 8 -8z" />
    </svg>
  ),
  ExternalLink: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M14 4h6v6M10 14L21 3" />
      <path d="M20 14v5a2 2 0 0 1 -2 2H5a2 2 0 0 1 -2 -2V6a2 2 0 0 1 2 -2h5" />
    </svg>
  ),
  Layers: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M12 2l10 6 -10 6 -10 -6z" />
      <path d="M2 14l10 6 10 -6" />
    </svg>
  ),
  Hash: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M5 9h14M5 15h14M10 3l-2 18M16 3l-2 18" />
    </svg>
  ),
  Mail: (p: IconProps) => (
    <svg {...base(p)}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9 -6" />
    </svg>
  ),
  Lock: (p: IconProps) => (
    <svg {...base(p)}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  ),
  LockSparkle: (p: IconProps) => (
    <svg {...base(p)}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      <path d="M18 4l-1 2 -2 1 2 1 1 2 1 -2 2 -1 -2 -1z" />
    </svg>
  ),
  User: (p: IconProps) => (
    <svg {...base(p)}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  )
};

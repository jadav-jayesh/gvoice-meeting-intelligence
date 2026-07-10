import clsx from "clsx";
import type { ReactNode } from "react";

type Tone =
  | "neutral"
  | "positive"
  | "negative"
  | "warn"
  | "info"
  | "brand";

const tones: Record<Tone, string> = {
  neutral: "bg-surfaceHi text-inkSoft border-line",
  positive: "bg-positive/10 text-positive border-positive/20 dark:text-positiveHi",
  negative: "bg-negative/10 text-negative border-negative/20 dark:text-negativeHi",
  warn: "bg-warn/10 text-warn border-warn/20",
  info: "bg-info/10 text-info border-info/20",
  brand: "bg-brand-500/10 text-brand-600 dark:text-brand-400 border-brand-500/20"
};

interface BadgeProps {
  children: ReactNode;
  className?: string;
  tone?: Tone;
  dot?: boolean;
}

export function Badge({ children, className, tone = "neutral", dot }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tones[tone],
        className
      )}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}

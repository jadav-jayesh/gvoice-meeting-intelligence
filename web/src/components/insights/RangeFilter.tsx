import type { InsightRange } from "../../lib/api";

const OPTIONS: Array<{ value: InsightRange; label: string }> = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "all", label: "All" }
];

// Compact segmented control for scoping insight widgets by time range.
export function RangeFilter({
  value,
  onChange
}: {
  value: InsightRange;
  onChange: (range: InsightRange) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors focus-ring ${
            value === opt.value
              ? "bg-accent text-white"
              : "text-inkMute hover:text-ink hover:bg-surfaceHi"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

interface Props {
  positive: number;
  neutral: number;
  negative: number;
  size?: number;
  thickness?: number;
}

export function SentimentRing({
  positive,
  neutral,
  negative,
  size = 160,
  thickness = 14
}: Props) {
  const total = positive + neutral + negative;
  if (total === 0) {
    return (
      <div
        className="rounded-full border border-dashed border-line flex items-center justify-center text-inkFaint text-xs"
        style={{ width: size, height: size }}
      >
        No data
      </div>
    );
  }
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const segments = [
    { value: positive, color: "#10B981", label: "Positive" },
    { value: neutral, color: "#94a3b8", label: "Neutral" },
    { value: negative, color: "#dc2626", label: "Negative" }
  ];
  let offset = 0;
  const positiveShare = Math.round((positive / total) * 100);

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4 w-full">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="var(--line)"
            strokeWidth={thickness}
            fill="none"
          />
          {segments.map((segment, index) => {
            const share = segment.value / total;
            const length = circumference * share;
            const dasharray = `${length} ${circumference - length}`;
            const dashoffset = -offset;
            offset += length;
            return (
              <circle
                key={index}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke={segment.color}
                strokeWidth={thickness}
                strokeLinecap="butt"
                strokeDasharray={dasharray}
                strokeDashoffset={dashoffset}
                fill="none"
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] uppercase tracking-widest text-inkFaint">Positive</span>
          <span className="text-3xl font-semibold tabular-nums text-ink mt-0.5">{positiveShare}%</span>
        </div>
      </div>
      <ul className="space-y-2 text-sm">
        {segments.map((segment) => {
          const share = Math.round((segment.value / total) * 100);
          return (
            <li key={segment.label} className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: segment.color }} />
              <span className="text-inkSoft text-[13px] min-w-[72px]">{segment.label}</span>
              <span className="text-inkMute tabular-nums text-xs">{share}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

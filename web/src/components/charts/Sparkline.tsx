interface Props {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fillId?: string;
  fillFrom?: string;
  fillTo?: string;
  className?: string;
}

// Minimal sparkline: 2px stroke, soft fill, small dot at the latest point.
export function Sparkline({
  values,
  width = 240,
  height = 56,
  stroke = "#06B6D4",
  fillId = "spark",
  fillFrom = "rgba(6, 182, 212, 0.18)",
  fillTo = "rgba(6, 182, 212, 0)",
  className
}: Props) {
  if (values.length === 0) return null;
  const pad = 3;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = max - min || 1;
  const step = innerW / Math.max(1, values.length - 1);

  const points = values.map((v, i) => ({
    x: pad + i * step,
    y: pad + innerH - ((v - min) / range) * innerH
  }));
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
  const area = `${line} L ${points[points.length - 1].x.toFixed(2)} ${height - pad} L ${points[0].x.toFixed(2)} ${height - pad} Z`;
  const last = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fillFrom} />
          <stop offset="100%" stopColor={fillTo} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${fillId})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r={2.5} fill={stroke} />
    </svg>
  );
}

interface Props {
  /** Newest day last. Each entry is a count for that day. */
  values: number[];
  weeks?: number;
  cellSize?: number;
  gap?: number;
  className?: string;
}

// GitHub-style contribution heatmap. Renders the last `weeks` weeks of activity
// as vertical 7-cell columns. Intensity is mapped to 4 quartile-based steps.
export function Heatmap({ values, weeks = 26, cellSize = 12, gap = 3, className }: Props) {
  // Take last weeks*7 entries (zero-padded at the front if short)
  const needed = weeks * 7;
  const data =
    values.length >= needed
      ? values.slice(values.length - needed)
      : new Array(needed - values.length).fill(0).concat(values);

  const max = Math.max(1, ...data);
  const quartile = (v: number) => {
    if (v === 0) return 0;
    const ratio = v / max;
    if (ratio < 0.25) return 1;
    if (ratio < 0.5) return 2;
    if (ratio < 0.75) return 3;
    return 4;
  };

  // Generate cells grouped by week column
  const columns: Array<Array<{ value: number; level: number }>> = [];
  for (let w = 0; w < weeks; w += 1) {
    const col: Array<{ value: number; level: number }> = [];
    for (let d = 0; d < 7; d += 1) {
      const i = w * 7 + d;
      const v = data[i] ?? 0;
      col.push({ value: v, level: quartile(v) });
    }
    columns.push(col);
  }

  const width = weeks * (cellSize + gap) - gap;
  const height = 7 * (cellSize + gap) - gap;

  // Month labels (rough): we sample the first cell of each week and label when
  // a new month begins.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekStartDate = (weekIdx: number) => {
    const d = new Date(today);
    const offsetDays = (weeks - 1 - weekIdx) * 7;
    d.setDate(d.getDate() - offsetDays - 6); // align to Sunday of that week
    return d;
  };
  const monthLabels: Array<{ x: number; label: string }> = [];
  let lastMonth = -1;
  for (let w = 0; w < weeks; w += 1) {
    const date = weekStartDate(w);
    if (date.getMonth() !== lastMonth) {
      lastMonth = date.getMonth();
      monthLabels.push({
        x: w * (cellSize + gap),
        label: date.toLocaleString(undefined, { month: "short" })
      });
    }
  }

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${width} ${height + 14}`}
        width="100%"
        height={height + 14}
        preserveAspectRatio="xMinYMin meet"
        aria-hidden
      >
        {monthLabels.map((m, i) => (
          <text
            key={i}
            x={m.x}
            y={9}
            fontSize={9}
            fill="var(--ink-faint)"
            fontFamily="Inter, sans-serif"
          >
            {m.label}
          </text>
        ))}
        <g transform="translate(0, 14)">
          {columns.map((col, w) =>
            col.map((cell, d) => {
              const x = w * (cellSize + gap);
              const y = d * (cellSize + gap);
              const fill =
                cell.level === 0
                  ? "var(--surface-hi)"
                  : cell.level === 1
                    ? "rgb(6 182 212 / 0.30)"
                    : cell.level === 2
                      ? "rgb(6 182 212 / 0.55)"
                      : cell.level === 3
                        ? "rgb(6 182 212 / 0.80)"
                        : "rgb(6 182 212)";
              return (
                <rect
                  key={`${w}-${d}`}
                  x={x}
                  y={y}
                  width={cellSize}
                  height={cellSize}
                  rx={2.5}
                  ry={2.5}
                  fill={fill}
                >
                  <title>
                    {cell.value} meeting{cell.value === 1 ? "" : "s"}
                  </title>
                </rect>
              );
            })
          )}
        </g>
      </svg>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-inkMute">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((level) => {
          const fill =
            level === 0
              ? "bg-surfaceHi"
              : level === 1
                ? "bg-brand-500/30"
                : level === 2
                  ? "bg-brand-500/55"
                  : level === 3
                    ? "bg-brand-500/80"
                    : "bg-brand-500";
          return (
            <span key={level} className={`w-2.5 h-2.5 rounded-sm ${fill}`} />
          );
        })}
        <span>More</span>
      </div>
    </div>
  );
}

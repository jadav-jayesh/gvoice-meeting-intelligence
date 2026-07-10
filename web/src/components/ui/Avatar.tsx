import clsx from "clsx";
import { gradientFromString } from "../../theme/theme.config.js";

interface Props {
  name: string;
  size?: number;
  className?: string;
}

// Solid swatch + subtle vertical highlight = looks dimensional without being
// loud. Palette is curated, not random.
export function Avatar({ name, size = 28, className }: Props) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?";

  // Stable aqua gradient per name, from the single-source theme config.
  const [from, to] = gradientFromString(name);

  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center rounded-full text-white font-medium shrink-0 select-none",
        className
      )}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
        fontSize: Math.max(10, size * 0.38),
        lineHeight: 1,
        boxShadow: "inset 0 1px 0 0 rgb(255 255 255 / 0.18)"
      }}
    >
      {initials}
    </span>
  );
}

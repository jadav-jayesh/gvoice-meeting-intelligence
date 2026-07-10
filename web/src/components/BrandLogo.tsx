interface Props {
  height?: number;
  className?: string;
  /** Show the "gVoice" wordmark beside the icon. Default true. */
  wordmark?: boolean;
}

// gVoice brand lockup: aqua icon + wordmark. The icon tile is self-contained
// (its own aqua gradient), so the same asset works on light and dark surfaces —
// no per-theme swap needed.
export function BrandLogo({ height = 32, className, wordmark = true }: Props) {
  return (
    <span className={`inline-flex items-center gap-2.5 select-none ${className ?? ""}`}>
      <img
        src="/logo-light.png"
        alt="gVoice"
        style={{ height, width: height }}
        className="object-contain rounded-[22%]"
        draggable={false}
      />
      {wordmark && (
        <span
          className="font-display font-semibold tracking-tight text-ink leading-none"
          style={{ fontSize: Math.round(height * 0.62) }}
        >
          gVoice
        </span>
      )}
    </span>
  );
}

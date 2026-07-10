import { useEffect, useRef, useState } from "react";

interface Props {
  value: number;
  duration?: number;
  format?: (value: number) => string;
  className?: string;
}

// Tween a number using requestAnimationFrame. Starts only after the element is
// scrolled into view, so multiple cards on a page don't all churn at once and
// the animation feels intentional.
export function AnimatedCounter({
  value,
  duration = 850,
  format = (v) => Math.round(v).toLocaleString(),
  className
}: Props) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLSpanElement | null>(null);
  const hasAnimated = useRef(false);
  const raf = useRef<number | null>(null);

  // Cancel any in-flight tween on unmount
  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current);
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    const node = ref.current;

    function startTween(from: number, to: number) {
      const start = performance.now();
      function step(now: number) {
        const t = Math.min(1, (now - start) / duration);
        // ease-out cubic
        const eased = 1 - Math.pow(1 - t, 3);
        setDisplay(from + (to - from) * eased);
        if (t < 1) raf.current = requestAnimationFrame(step);
      }
      raf.current = requestAnimationFrame(step);
    }

    // First time we become visible, animate from 0 -> value.
    if (!hasAnimated.current) {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && !hasAnimated.current) {
              hasAnimated.current = true;
              startTween(0, value);
              observer.disconnect();
            }
          }
        },
        { threshold: 0.4 }
      );
      observer.observe(node);
      return () => observer.disconnect();
    }
    // Subsequent value changes: tween from current display to new value.
    startTween(display, value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return (
    <span ref={ref} className={className}>
      {format(display)}
    </span>
  );
}

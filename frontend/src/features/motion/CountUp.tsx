import { useEffect, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";

interface CountUpProps {
  /** Target value; null or non-finite values are shown through `format` unchanged. */
  value: number | null | undefined;
  format: (value: number | null | undefined) => string;
  duration?: number;
}

/** A number that rises from zero to its value with an ease-out curve. */
export function CountUp({ value, format, duration = 900 }: CountUpProps) {
  const reduced = useReducedMotion();
  const animatable = typeof value === "number" && Number.isFinite(value) && !reduced;
  const [current, setCurrent] = useState<number | null | undefined>(animatable ? 0 : value);

  useEffect(() => {
    if (!animatable) {
      setCurrent(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setCurrent(progress >= 1 ? value : (value as number) * eased);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, animatable]);

  return (
    <>
      <span className="visually-hidden">{format(value)}</span>
      <span aria-hidden="true">{format(current)}</span>
    </>
  );
}

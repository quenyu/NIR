import { useEffect, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";

const GLYPHS = "#%&*+=/<>01";
const MS_PER_CHAR = 26;
const TAIL = 3;

interface ScrambleTextProps {
  text: string;
  /** Milliseconds before typing starts. */
  delay?: number;
  className?: string;
}

/**
 * Types `text` in letter by letter, the next few letters flickering as random
 * glyphs, whenever the text changes. The real text stays in the DOM for
 * assistive technology and tests; the animated copy is presentation only.
 */
export function ScrambleText({ text, delay = 0, className }: ScrambleTextProps) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? text : "");

  useEffect(() => {
    if (reduced) {
      setShown(text);
      return;
    }
    let frame = 0;
    const start = performance.now() + delay;
    const step = (now: number) => {
      const elapsed = now - start;
      const count = elapsed <= 0 ? 0 : Math.floor(elapsed / MS_PER_CHAR);
      if (count >= text.length) {
        setShown(text);
        return;
      }
      let tail = "";
      if (elapsed > 0) {
        for (let index = count; index < Math.min(text.length, count + TAIL); index += 1) {
          tail += text[index] === " " ? " " : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        }
      }
      setShown(text.slice(0, count) + tail);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [text, delay, reduced]);

  return (
    <span className={className}>
      <span className="visually-hidden">{text}</span>
      <span aria-hidden="true">{shown}</span>
    </span>
  );
}

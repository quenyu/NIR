import { useEffect, useRef } from "react";
import { motionEnabled } from "../../features/motion/useReducedMotion";

/** Fired by the run button: a soft ripple spreads through the stars from (x, y). */
export const RUN_WAVE_EVENT = "cl-run-wave";

export function emitRunWave(element: Element | null): void {
  const rect = element?.getBoundingClientRect();
  const detail = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  window.dispatchEvent(new CustomEvent(RUN_WAVE_EVENT, { detail }));
}

const CLOUDS: Array<[number, number, number, string]> = [
  [0.28, 0.35, 360, "38,72,160"], [0.68, 0.62, 420, "24,46,120"], [0.52, 0.2, 260, "60,90,190"],
  [0.12, 0.78, 300, "20,40,110"], [0.86, 0.22, 240, "70,60,160"],
];

/**
 * Deep-space backdrop behind the whole interface: a dark blue gradient, a faint
 * drifting nebula and three depth layers of twinkling stars with mouse parallax.
 */
export function SpaceBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const stars = Array.from({ length: 520 }, () => ({
      x: Math.random(), y: Math.random(), z: Math.random() ** 2.2, phase: Math.random() * Math.PI * 2, speed: 0.6 + Math.random() * 1.6,
    }));
    const nebula = document.createElement("canvas");
    nebula.width = 1024;
    nebula.height = 640;
    const nebulaContext = nebula.getContext("2d")!;
    for (const [x, y, r, color] of CLOUDS) {
      const gradient = nebulaContext.createRadialGradient(x * 1024, y * 640, 0, x * 1024, y * 640, r);
      gradient.addColorStop(0, `rgba(${color},.20)`);
      gradient.addColorStop(0.5, `rgba(${color},.07)`);
      gradient.addColorStop(1, `rgba(${color},0)`);
      nebulaContext.fillStyle = gradient;
      nebulaContext.fillRect(0, 0, 1024, 640);
    }

    let width = 0;
    let height = 0;
    const mouse = { x: 0, y: 0 };
    let wave = 0;
    const origin = { x: 0, y: 0 };
    let frame = 0;
    const start = performance.now();

    function resize() {
      const ratio = Math.min(window.devicePixelRatio, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas!.width = width * ratio;
      canvas!.height = height * ratio;
      context!.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    function onPointer(event: PointerEvent) {
      mouse.x = event.clientX / window.innerWidth - 0.5;
      mouse.y = event.clientY / window.innerHeight - 0.5;
    }
    function onWave(event: Event) {
      if (!motionEnabled()) return;
      const detail = (event as CustomEvent<{ x: number; y: number }>).detail;
      origin.x = detail.x;
      origin.y = detail.y;
      wave = 1;
    }

    function draw(now: number) {
      const moving = motionEnabled() && !document.hidden;
      const time = moving ? now / 1000 : 0;
      const fadeIn = Math.min(1, (now - start) / 1200);
      const gradient = context!.createRadialGradient(width * 0.45, height * 0.45, 0, width * 0.45, height * 0.45, Math.max(width, height) * 0.75);
      gradient.addColorStop(0, "#071431");
      gradient.addColorStop(0.55, "#030919");
      gradient.addColorStop(1, "#01030a");
      context!.globalAlpha = 1;
      context!.fillStyle = gradient;
      context!.fillRect(0, 0, width, height);
      context!.globalAlpha = 0.9 * fadeIn;
      const dx = Math.sin(time * 0.03) * 40 - mouse.x * 20;
      const dy = Math.cos(time * 0.025) * 24 - mouse.y * 14;
      context!.drawImage(nebula, -60 + dx, -40 + dy, width + 120, height + 80);
      for (const star of stars) {
        const depth = 0.3 + star.z * 1.7;
        if (moving) star.x = (star.x + 0.000012 * depth) % 1;
        const px = star.x * width - mouse.x * 30 * depth;
        const py = star.y * height - mouse.y * 20 * depth;
        let ripple = 0;
        if (wave > 0) ripple = Math.max(0, 1 - Math.abs(Math.hypot(px - origin.x, py - origin.y) - wave) / 80);
        const twinkle = moving ? 0.5 + 0.5 * Math.sin(time * star.speed + star.phase) : 0.7;
        context!.globalAlpha = Math.min(1, fadeIn * (0.15 + 0.6 * star.z) * (0.55 + 0.45 * twinkle) + ripple * 0.7);
        context!.fillStyle = star.z > 0.7 ? "#dbe7ff" : "#9fb6e6";
        const size = 0.5 + star.z * 1.4 + ripple * 1.4;
        context!.fillRect(px, py, size, size);
      }
      context!.globalAlpha = 1;
      if (wave > 0) {
        wave += 16;
        if (wave > Math.hypot(width, height)) wave = 0;
      }
      frame = requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointer);
    window.addEventListener(RUN_WAVE_EVENT, onWave);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener(RUN_WAVE_EVENT, onWave);
    };
  }, []);

  return <canvas ref={canvasRef} className="space-backdrop" aria-hidden="true" />;
}

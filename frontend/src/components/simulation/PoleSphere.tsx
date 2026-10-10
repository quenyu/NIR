import { useEffect, useRef } from "react";
import { ParticleSphere, type Pole } from "../../features/sphere/ParticleSphere";
import { motionEnabled } from "../../features/motion/useReducedMotion";
import { formatRussianCount } from "../../features/modelingWorkspace";

interface PoleSphereProps {
  poles: Pole[];
}

/** The model sphere: each pole of the assembled model orbits the particle sphere (see ParticleSphere). */
export function PoleSphere({ poles }: PoleSphereProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sphereRef = useRef<ParticleSphere | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    let sphere: ParticleSphere;
    try {
      sphere = new ParticleSphere(canvas);
    } catch {
      return; // no WebGL: the plane view next to it still shows the poles
    }
    sphereRef.current = sphere;
    sphere.cameraDistance = 7.6;
    sphere.cameraHeight = 1.9;
    sphere.assembly = motionEnabled() ? 0 : 1;
    const resize = () => sphere.resize(wrap.clientWidth, wrap.clientHeight);
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    resize();
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      sphere.animate = motionEnabled() && !document.hidden;
      sphere.assembly = sphere.animate ? Math.min(1, (now - start) / 1400) : 1;
      sphere.render(now);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      sphere.dispose();
      sphereRef.current = null;
    };
  }, []);

  useEffect(() => {
    sphereRef.current?.setPoles(poles);
    sphereRef.current?.kick();
  }, [poles]);

  const unstable = poles.some((pole) => pole.real > 1e-9);
  return (
    <div className="pole-sphere" ref={wrapRef} data-testid="pole-sphere">
      <canvas ref={canvasRef} aria-label={`Сфера модели: ${formatRussianCount(poles.length, "полюс", "полюса", "полюсов")}${unstable ? ", есть неустойчивые" : ""}`} />
      <p className="pole-sphere__legend">
        <span><i className="pole-sphere__dot" />устойчивый полюс</span>
        <span><i className="pole-sphere__dot is-unstable" />неустойчивый</span>
        <span>радиус орбиты — |λ|, наклон — 1 − ζ, скорость — ω</span>
      </p>
    </div>
  );
}

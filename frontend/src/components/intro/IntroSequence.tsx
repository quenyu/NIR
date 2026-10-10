import { useEffect, useRef, useState } from "react";
import { checkHealth, errorText, listServerProjects } from "../../api/client";
import { formatRussianCount } from "../../features/modelingWorkspace";
import { ParticleSphere, easeOut } from "../../features/sphere/ParticleSphere";
import { ScrambleText } from "../../features/motion/ScrambleText";

const INTRO_KEY = "cl-intro";
const MIN_DURATION = 6.2; // seconds of choreography before the hand-off
const MAX_WAIT = 12; // a step that never answers does not hold the intro longer than this

export function introEnabled(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get("intro") === "0") return false;
    return window.localStorage.getItem(INTRO_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setIntroEnabled(value: boolean): void {
  try {
    window.localStorage.setItem(INTRO_KEY, value ? "on" : "off");
  } catch {
    // Without storage the choice lasts for this page only.
  }
}

interface Step {
  title: string;
  run: () => Promise<string>;
}

type StepState = { detail: string; status: "pending" | "done" | "error" };

interface IntroSequenceProps {
  blockTypeCount: number;
  exampleCount: number;
  onDone: () => void;
}

/**
 * Opening sequence: the particle sphere assembles and its orbits trace in,
 * while the boot log runs the real start-up checks of the environment.
 */
export function IntroSequence({ blockTypeCount, exampleCount, onDone }: IntroSequenceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [states, setStates] = useState<StepState[]>([]);
  const statesRef = useRef<StepState[]>([]);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const finishRef = useRef<() => void>(() => {});

  const steps: Step[] = [
    { title: "Соединение с сервером моделирования", run: async () => { await checkHealth(); return "/health"; } },
    { title: "Библиотека блоков", run: async () => formatRussianCount(blockTypeCount, "тип", "типа", "типов") },
    { title: "Готовые схемы", run: async () => String(exampleCount) },
    { title: "Проекты на сервере", run: async () => formatRussianCount((await listServerProjects()).length, "проект", "проекта", "проектов") },
    { title: "Шрифты интерфейса", run: async () => { await document.fonts.ready; return "Geist Mono · Geist Sans"; } },
    { title: "Графическое ядро", run: async () => (canvasRef.current?.getContext("webgl2") || canvasRef.current?.getContext("webgl") ? "WebGL" : "WebGL недоступен") },
  ];

  useEffect(() => {
    const initial = steps.map(() => ({ detail: "", status: "pending" as const }));
    statesRef.current = initial;
    setStates(initial);
    steps.forEach((step, index) => {
      step.run()
        .then((detail) => ({ detail, status: "done" as const }))
        .catch((error: unknown) => ({ detail: errorText(error, "нет ответа"), status: "error" as const }))
        .then((state) => {
          statesRef.current = statesRef.current.map((current, i) => (i === index ? state : current));
          setStates(statesRef.current);
        });
    });
    // The checks run once per mount; their inputs are fixed for the intro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    let sphere: ParticleSphere | null = null;
    try {
      sphere = new ParticleSphere(canvas);
    } catch {
      sphere = null; // no WebGL: the boot log still runs
    }
    sphere?.setPoles([{ real: -0.6, imag: 2.94 }, { real: -0.6, imag: -2.94 }]);
    const resize = () => sphere?.resize(stage.clientWidth, stage.clientHeight);
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();

    const start = performance.now();
    let frame = 0;
    let leavingAt = 0;
    const finish = () => {
      if (leavingAt) return;
      leavingAt = performance.now();
      setLeaving(true);
    };
    finishRef.current = finish;
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      setElapsed(t);
      if (sphere) {
        const out = leavingAt ? easeOut((now - leavingAt) / 900) : 0;
        sphere.assembly = Math.min(1, Math.max(0, (t - 0.4) / 2.0)) * (1 - out * 0.4);
        sphere.orbitsIn = Math.min(1, Math.max(0, (t - 2.0) / 1.2));
        sphere.haloOpacity = easeOut((t - 1.4) / 1.5) * (1 - out);
        sphere.cameraDistance = 6.6 + out * 2.4;
        sphere.render(now);
      }
      const settled = statesRef.current.length > 0 && statesRef.current.every((state) => state.status !== "pending");
      if (!leavingAt && ((t >= MIN_DURATION && settled) || t >= MAX_WAIT)) finish();
      if (leavingAt && now - leavingAt > 900) {
        doneRef.current();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const skip = (event: KeyboardEvent) => {
      if (event.key !== "Tab") finish();
    };
    window.addEventListener("keydown", skip);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("keydown", skip);
      sphere?.dispose();
    };
  }, []);

  const total = Math.min(1, elapsed / MIN_DURATION);
  const failed = states.some((state) => state.status === "error");

  return (
    <section className={`intro ${leaving ? "is-leaving" : ""}`} aria-label="Загрузка Control Lab" data-testid="intro">
      <header className="intro__top">
        <div className="intro__cols">
          <span>CONTROL LAB</span><span className="hud-key">Модель</span><span>• ẋ = Ax + Br</span>
          <span className="hud-key">Моделирование САУ</span><span className="hud-key">Решатели</span><span>• RK45 · RK4</span>
        </div>
      </header>
      <div className="intro__stage">
        <div className="intro__sphere" ref={stageRef}>
          <canvas ref={canvasRef} aria-hidden="true" />
          {elapsed > 2.4 && <p className="intro__motto"><ScrambleText text="[ Схема → модель ẋ = Ax + Br → результат ]" /></p>}
        </div>
        <div className="intro__boot">
          <div className="intro__boot-head">
            <span className="hud-key">Загрузка среды</span>
            <span className={`hud-key ${failed ? "is-error" : ""}`}>{total >= 1 ? (failed ? "Есть ошибки" : "Готово") : "Загрузка"}</span>
          </div>
          {steps.map((step, index) => {
            const begin = 0.9 + index * 0.55;
            const state = states[index];
            // The bar runs on the clock but holds at 90 % until the real check answers.
            const timed = easeOut((elapsed - begin) / 0.9);
            const progress = state?.status === "pending" ? Math.min(timed, 0.9) : timed;
            const visible = elapsed >= begin;
            return (
              <div key={step.title} className={`intro__step ${visible ? "is-on" : ""} ${state?.status === "error" ? "is-error" : ""}`}>
                <span className="intro__n">{String(index + 1).padStart(2, "0")}</span>
                <span className="intro__t">
                  {visible && <ScrambleText text={step.title} />}
                  {state?.detail && progress >= 0.99 && <small>{state.detail}</small>}
                </span>
                <span className="intro__p">{state?.status === "error" && progress >= 0.99 ? "ошибка" : `${Math.round(progress * 100)}%`}</span>
                <span className="intro__bar"><i style={{ transform: `scaleX(${progress.toFixed(3)})` }} /></span>
              </div>
            );
          })}
        </div>
      </div>
      <footer className="intro__bottom">
        <span className="hud-key">Запуск Control Lab</span>
        <span className="intro__total"><i style={{ transform: `scaleX(${total.toFixed(3)})` }} /></span>
        <button type="button" className="hud-link" onClick={() => finishRef.current()} data-testid="intro-skip">Пропустить →</button>
      </footer>
    </section>
  );
}

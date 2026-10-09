import { useEffect, useRef } from "react";
import { formatRussianCount } from "../../features/modelingWorkspace";

export type SolverName = "rk4" | "solve_ivp";

interface StatusBarProps {
  nodeCount: number;
  edgeCount: number;
  depth: number;
  /** n, m, p of the last assembled model, if any. */
  dimensions: { n: number; m: number; p: number } | null;
  solver: SolverName;
  onSolverChange: (solver: SolverName) => void;
  tEnd: number;
  onTEndChange: (value: number) => void;
  dt: number;
  onDtChange: (value: number) => void;
}

function solverShort(solver: SolverName): string {
  return solver === "solve_ivp" ? "RK45" : "RK4";
}

/** One line of model facts at the bottom of the screen, plus the solver settings. */
export function StatusBar({
  nodeCount,
  edgeCount,
  depth,
  dimensions,
  solver,
  onSolverChange,
  tEnd,
  onTEndChange,
  dt,
  onDtChange,
}: StatusBarProps) {
  const solverRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const popover = solverRef.current;
      if (popover?.open && event.target instanceof window.Node && !popover.contains(event.target)) {
        popover.removeAttribute("open");
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return (
    <footer className="hud-statusbar">
      <span data-testid="diagram-stats">
        {formatRussianCount(nodeCount, "блок", "блока", "блоков")} · {formatRussianCount(edgeCount, "связь", "связи", "связей")}
      </span>
      <span><span className="hud-key">Уровень</span> {depth}</span>
      {dimensions && (
        <span title="Порядок модели, число входов и выходов">
          <span className="hud-math">n</span> {dimensions.n} · <span className="hud-math">m</span> {dimensions.m} · <span className="hud-math">p</span> {dimensions.p}
        </span>
      )}
      <span className="hud-statusbar__spacer" />
      <details ref={solverRef} className="hud-solver">
        <summary data-testid="solver-settings-button" title="Параметры расчёта">
          <span className="hud-key">Расчёт</span> {solverShort(solver)} · 0…{tEnd} с · dt {dt}
        </summary>
        <div className="hud-solver__popover">
          <label className="hud-field">
            <span className="hud-key">Метод</span>
            <select value={solver} onChange={(event) => onSolverChange(event.target.value as SolverName)} data-testid="solver-select">
              <option value="solve_ivp">RK45, адаптивный шаг</option>
              <option value="rk4">RK4, постоянный шаг</option>
            </select>
          </label>
          <label className="hud-field">
            <span className="hud-key">Интервал t_end, с</span>
            <input type="number" value={tEnd} min={0} onChange={(event) => onTEndChange(Number(event.target.value))} data-testid="t-end-input" />
          </label>
          <label className="hud-field">
            <span className="hud-key">Шаг dt, с</span>
            <input type="number" value={dt} step="0.001" min={0} onChange={(event) => onDtChange(Number(event.target.value))} data-testid="dt-input" />
          </label>
        </div>
      </details>
    </footer>
  );
}

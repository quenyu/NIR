import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeDiagram, runObserverExperiment } from "../../api/client";
import type {
  ObserverExperimentResponse,
  SimulationResponse,
  SystemAnalysis,
} from "../../types/api";
import type { Diagram } from "../../types/diagram";
import Plot from "../Plot";
import { PLOT_FONT_COLOR, PLOT_UI_FONT_FAMILY } from "../plotTypography";

interface ObserverPanelProps {
  diagram: Diagram | null;
  simulation: SimulationResponse | null;
}

interface ObserverOptions {
  horizon: number;
  dt: number;
  inputAmplitude: number;
  stepTime: number;
  initialStateScale: number;
  observerSpeedFactor: number;
  processNoiseStd: number;
  measurementNoiseStd: number;
}

const DEFAULT_OPTIONS: ObserverOptions = {
  horizon: 6,
  dt: 0.02,
  inputAmplitude: 1,
  stepTime: 0,
  initialStateScale: 1,
  observerSpeedFactor: 3,
  processNoiseStd: 0.01,
  measurementNoiseStd: 0.05,
};

const plotTheme = {
  paper_bgcolor: "#000000",
  plot_bgcolor: "#000000",
  font: { color: PLOT_FONT_COLOR, family: PLOT_UI_FONT_FAMILY, size: 13 },
  margin: { l: 62, r: 18, b: 52, t: 38 },
  legend: { orientation: "h" as const, y: -0.2 },
  xaxis: { title: "Время, с", gridcolor: "#202020", zerolinecolor: "#505050" },
  yaxis: { gridcolor: "#202020", zerolinecolor: "#505050" },
};

function formatNumber(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "н/д";
  if (Math.abs(value) > 0 && (Math.abs(value) < 1e-3 || Math.abs(value) >= 1e4)) {
    return value.toExponential(2);
  }
  return value.toFixed(digits);
}

function formatMatrix(matrix: number[][]): string {
  return matrix.map((row) => `[${row.map((value) => formatNumber(value, 3)).join(", ")}]`).join(" ");
}

function formatPoles(poles: Array<{ real: number; imag: number }>): string {
  return poles.map((pole) => {
    if (Math.abs(pole.imag) < 1e-10) return formatNumber(pole.real, 3);
    return `${formatNumber(pole.real, 3)} ${pole.imag >= 0 ? "+" : "−"} ${formatNumber(Math.abs(pole.imag), 3)}i`;
  }).join(", ");
}

export function ObserverPanel({ diagram, simulation }: ObserverPanelProps) {
  const diagramKey = useMemo(() => diagram ? JSON.stringify(diagram) : "", [diagram]);
  const [system, setSystem] = useState<SystemAnalysis | null>(simulation?.system_analysis ?? null);
  const [inputBlockId, setInputBlockId] = useState("");
  const [outputLabel, setOutputLabel] = useState("");
  const [selectedState, setSelectedState] = useState(0);
  const [options, setOptions] = useState<ObserverOptions>(DEFAULT_OPTIONS);
  const [result, setResult] = useState<ObserverExperimentResponse | null>(null);
  const [error, setError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  useEffect(() => {
    let cancelled = false;
    if (!diagram || !diagramKey) {
      setSystem(null);
      setIsAnalyzing(false);
      return () => { cancelled = true; };
    }
    if (simulation?.system_analysis) {
      setSystem(simulation.system_analysis);
      setError("");
      setIsAnalyzing(false);
      return () => { cancelled = true; };
    }
    setIsAnalyzing(true);
    setError("");
    void analyzeDiagram(diagram)
      .then((analysis) => {
        if (!cancelled) setSystem(analysis);
      })
      .catch((analysisError) => {
        if (!cancelled) {
          setSystem(null);
          setError(analysisError instanceof Error ? analysisError.message : "Не удалось собрать модель.");
        }
      })
      .finally(() => {
        if (!cancelled) setIsAnalyzing(false);
      });
    return () => { cancelled = true; };
  }, [diagramKey, simulation?.system_analysis]);

  useEffect(() => {
    if (!system) return;
    setInputBlockId((current) => system.input_blocks.includes(current) ? current : system.input_blocks[0] ?? "");
    setOutputLabel((current) => system.output_labels.includes(current) ? current : system.output_labels[0] ?? "");
    setSelectedState(0);
    setResult(null);
  }, [system]);

  function updateNumber<K extends keyof ObserverOptions>(key: K, value: string) {
    setOptions((current) => ({ ...current, [key]: Number(value) }));
  }

  async function runExperiment() {
    if (!diagram || !system || !inputBlockId || !outputLabel || isRunning) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsRunning(true);
    setError("");
    setResult(null);
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await runObserverExperiment({
        diagram,
        input_block_id: inputBlockId,
        output_label: outputLabel,
        horizon: options.horizon,
        dt: options.dt,
        input_amplitude: options.inputAmplitude,
        step_time: options.stepTime,
        initial_state_scale: options.initialStateScale,
        observer_speed_factor: options.observerSpeedFactor,
        process_noise_std: options.processNoiseStd,
        measurement_noise_std: options.measurementNoiseStd,
        seed: 42,
      }, controller.signal);
      setResult(response);
    } catch (runError) {
      setError(
        runError instanceof Error && runError.name === "AbortError"
          ? "Эксперимент остановлен по тайм-ауту. Уменьшите горизонт или увеличьте шаг."
          : runError instanceof Error
            ? runError.message
            : "Не удалось выполнить эксперимент с наблюдателями."
      );
    } finally {
      window.clearTimeout(timeout);
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setIsRunning(false);
      }
    }
  }

  if (isAnalyzing) return <p>Проверяем наблюдаемость и собираем матрицы модели…</p>;
  if (!system) return <div className="safe-learning-error" role="alert">{error || "Соберите корректную динамическую схему."}</div>;
  if (system.state_dimension === 0) return <p>Наблюдатель неприменим к статической схеме: добавьте динамический объект.</p>;

  const canRun = system.input_dimension > 0 && system.output_dimension > 0 && Boolean(inputBlockId && outputLabel);
  const selectedLabel = result?.trace.state_labels[selectedState] ?? `x${selectedState + 1}`;
  const kalmanBand = result?.trace.kalman_three_sigma[selectedState] ?? 0;
  const kalmanEstimate = result?.trace.kalman_states[selectedState] ?? [];

  return (
    <div className="safe-learning-view observer-view">
      <section className="safe-learning-intro">
        <div>
          <span>Оценивание состояния</span>
          <h3>Наблюдатель Люенбергера и стационарный фильтр Калмана</h3>
        </div>
        <p>
          Система переводится в дискретную ZOH-модель. Для Люенбергера полюса матрицы
          <code> Ad − LC</code> размещаются в z-плоскости; Калман получает усиление из DARE по
          заданным ковариациям <code>Q</code> и <code>R</code>. Оба алгоритма видят один и тот же шумовой эксперимент.
        </p>
      </section>

      <section className="safe-learning-controls observer-controls">
        <label className="tool-input"><span>Известный вход</span><select value={inputBlockId} onChange={(event) => setInputBlockId(event.target.value)} disabled={isRunning}>{system.input_blocks.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="tool-input"><span>Измеряемый Scope</span><select value={outputLabel} onChange={(event) => setOutputLabel(event.target.value)} disabled={isRunning}>{system.output_labels.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="tool-input"><span>Горизонт, с</span><input type="number" min={0.2} max={60} step={0.5} value={options.horizon} onChange={(event) => updateNumber("horizon", event.target.value)} disabled={isRunning} /></label>
        <label className="tool-input"><span>Шаг, с</span><input type="number" min={0.001} max={0.2} step={0.005} value={options.dt} onChange={(event) => updateNumber("dt", event.target.value)} disabled={isRunning} /></label>
        <label className="tool-input"><span>Амплитуда входа</span><input type="number" step={0.1} value={options.inputAmplitude} onChange={(event) => updateNumber("inputAmplitude", event.target.value)} disabled={isRunning} /></label>
        <label className="tool-input"><span>Момент скачка, с</span><input type="number" min={0} max={options.horizon} step={0.1} value={options.stepTime} onChange={(event) => updateNumber("stepTime", event.target.value)} disabled={isRunning} /></label>
        <label className="tool-input"><span>Норма x(0)</span><input type="number" min={0} max={100} step={0.1} value={options.initialStateScale} onChange={(event) => updateNumber("initialStateScale", event.target.value)} disabled={isRunning} /></label>
        <label className="tool-input"><span>Быстродействие L</span><input type="number" min={1.1} max={20} step={0.5} value={options.observerSpeedFactor} onChange={(event) => updateNumber("observerSpeedFactor", event.target.value)} disabled={isRunning} /></label>
        <label className="tool-input"><span>σ процесса / шаг</span><input type="number" min={0} max={10} step={0.005} value={options.processNoiseStd} onChange={(event) => updateNumber("processNoiseStd", event.target.value)} disabled={isRunning} /></label>
        <label className="tool-input"><span>σ измерения</span><input type="number" min={0} max={10} step={0.01} value={options.measurementNoiseStd} onChange={(event) => updateNumber("measurementNoiseStd", event.target.value)} disabled={isRunning} /></label>
        <button type="button" className="btn btn-primary safe-learning-run" disabled={!canRun || isRunning} onClick={() => void runExperiment()}>{isRunning ? "Расчёт оценок…" : "Сравнить наблюдатели"}</button>
      </section>

      <p className="safe-learning-assumption">
        Проверяется выбранная пара «известный вход → измеряемый выход». Для восстановления всех состояний
        необходимо <code>rank(O)=n</code>; если условие не выполнено, расчёт честно останавливается и предлагает другой Scope.
      </p>
      {error && <div className="safe-learning-error" role="alert">{error}</div>}

      {result && (
        <>
          <section className="safe-learning-summary">
            <article><span>Наблюдаемость</span><strong>{result.model.observability_rank} / {result.model.state_dimension}</strong><small>rank(O) / n</small></article>
            {result.metrics.map((metric) => (
              <article key={metric.method}><span>{metric.method === "kalman" ? "RMSE Калмана" : "RMSE Люенбергера"}</span><strong>{formatNumber(metric.state_rmse)}</strong><small>последние 80%: {formatNumber(metric.steady_state_rmse)}</small></article>
            ))}
            <article><span>3σ-покрытие Калмана</span><strong>{formatNumber(result.metrics.find((item) => item.method === "kalman")?.three_sigma_coverage_percent, 1)}%</strong><small>по стационарной P после переходного участка</small></article>
          </section>

          <label className="tool-input observer-state-selector">
            <span>Состояние на графике</span>
            <select value={selectedState} onChange={(event) => setSelectedState(Number(event.target.value))}>
              {result.trace.state_labels.map((label, index) => <option key={`${label}-${index}`} value={index}>{label}</option>)}
            </select>
          </label>

          <section className="safe-learning-plots">
            <article>
              <h3>Истинное и оценённое состояние {selectedLabel}</h3>
              <Plot
                data={[
                  { x: result.trace.time, y: kalmanEstimate.map((value) => value - kalmanBand), type: "scatter", mode: "lines", name: "−3σ", line: { width: 0, color: "rgba(126,126,126,0)" }, hoverinfo: "skip" },
                  { x: result.trace.time, y: kalmanEstimate.map((value) => value + kalmanBand), type: "scatter", mode: "lines", name: "±3σ Калмана", line: { width: 0, color: "rgba(126,126,126,0)" }, fill: "tonexty", fillcolor: "rgba(126,126,126,0.16)", hoverinfo: "skip" },
                  { x: result.trace.time, y: result.trace.true_states[selectedState], type: "scatter", mode: "lines", name: "Истинное x", line: { color: "#d9d9d9", width: 2.2 } },
                  { x: result.trace.time, y: result.trace.luenberger_states[selectedState], type: "scatter", mode: "lines", name: "Люенбергер", line: { color: "#7e7e7e", width: 1.6, dash: "dot" } },
                  { x: result.trace.time, y: kalmanEstimate, type: "scatter", mode: "lines", name: "Калман", line: { color: "#da5c2c", width: 2 } },
                ]}
                layout={{ ...plotTheme, title: selectedLabel, yaxis: { ...plotTheme.yaxis, title: "Состояние" } }}
                config={{ displayModeBar: false, responsive: true }} style={{ width: "100%", height: "330px" }} useResizeHandler
              />
            </article>
            <article>
              <h3>Норма ошибки оценивания</h3>
              <Plot data={[
                { x: result.trace.time, y: result.trace.luenberger_error_norm, type: "scatter", mode: "lines", name: "Люенбергер", line: { color: "#8a8a8a", width: 1.7 } },
                { x: result.trace.time, y: result.trace.kalman_error_norm, type: "scatter", mode: "lines", name: "Калман", line: { color: "#da5c2c", width: 2.1 } },
              ]} layout={{ ...plotTheme, yaxis: { ...plotTheme.yaxis, title: "||x − x̂||₂" } }} config={{ displayModeBar: false, responsive: true }} style={{ width: "100%", height: "330px" }} useResizeHandler />
            </article>
            <article>
              <h3>Истинный и измеренный выход</h3>
              <Plot data={[
                { x: result.trace.time, y: result.trace.measured_output, type: "scatter", mode: "lines", name: "Измерение", line: { color: "#606060", width: 1 } },
                { x: result.trace.time, y: result.trace.true_output, type: "scatter", mode: "lines", name: "Истинный y", line: { color: "#d9d9d9", width: 2 } },
              ]} layout={{ ...plotTheme, yaxis: { ...plotTheme.yaxis, title: "y" } }} config={{ displayModeBar: false, responsive: true }} style={{ width: "100%", height: "300px" }} useResizeHandler />
            </article>
            <article>
              <h3>Инновация измерения</h3>
              <Plot data={[
                { x: result.trace.time, y: result.trace.luenberger_innovation, type: "scatter", mode: "lines", name: "Люенбергер", line: { color: "#7e7e7e", width: 1.3 } },
                { x: result.trace.time, y: result.trace.kalman_innovation, type: "scatter", mode: "lines", name: "Калман", line: { color: "#da5c2c", width: 1.6 } },
              ]} layout={{ ...plotTheme, yaxis: { ...plotTheme.yaxis, title: "y − ŷ" } }} config={{ displayModeBar: false, responsive: true }} style={{ width: "100%", height: "300px" }} useResizeHandler />
            </article>
          </section>

          <section className="safe-learning-table-wrap">
            <h3>Синтез наблюдателей</h3>
            <table><thead><tr><th>Метод</th><th>Усиление L</th><th>Полюса Ad − LC</th><th>ρ</th><th>Шур-устойчив</th></tr></thead><tbody>
              {result.observers.map((observer) => <tr key={observer.method}><td>{observer.name}<br /><small>{observer.design}</small></td><td><code>{formatMatrix(observer.gain)}</code></td><td><code>{formatPoles(observer.error_dynamics_poles)}</code></td><td>{formatNumber(observer.spectral_radius)}</td><td>{observer.asymptotically_stable ? "да" : "нет"}</td></tr>)}
            </tbody></table>
          </section>

          <section className="safe-learning-table-wrap">
            <h3>Качество оценивания</h3>
            <table><thead><tr><th>Метод</th><th>RMSE состояния</th><th>RMSE установившийся</th><th>Средняя ||e||</th><th>Макс. ||e||</th><th>Улучшение к x̂=0</th></tr></thead><tbody>
              {result.metrics.map((metric) => <tr key={metric.method}><td>{metric.method === "kalman" ? "Калман" : "Люенбергер"}</td><td>{formatNumber(metric.state_rmse)}</td><td>{formatNumber(metric.steady_state_rmse)}</td><td>{formatNumber(metric.mean_error_norm)}</td><td>{formatNumber(metric.max_error_norm)}</td><td>{formatNumber(metric.improvement_over_zero_estimate_percent, 1)}%</td></tr>)}
            </tbody></table>
          </section>

          {result.warnings.length > 0 && <ul className="safe-learning-warnings">{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
        </>
      )}
    </div>
  );
}

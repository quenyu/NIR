import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeDiagram, runOutputFeedbackExperiment } from "../../api/client";
import type {
  OutputFeedbackResponse,
  SimulationResponse,
  SystemAnalysis,
} from "../../types/api";
import type { Diagram } from "../../types/diagram";
import { openDefenseReport } from "../../features/defenseReport";
import Plot from "../Plot";
import { PLOT_FONT_COLOR, PLOT_UI_FONT_FAMILY } from "../plotTypography";

interface OutputFeedbackPanelProps {
  diagram: Diagram | null;
  simulation: SimulationResponse | null;
}

interface OutputFeedbackOptions {
  horizon: number;
  dt: number;
  initialStateScale: number;
  observerSpeedFactor: number;
  processNoiseStd: number;
  measurementNoiseStd: number;
  stateWeight: number;
  controlWeight: number;
  controlLimit: number;
  reference: number;
}

const DEFAULT_OPTIONS: OutputFeedbackOptions = {
  horizon: 6,
  dt: 0.02,
  initialStateScale: 1,
  observerSpeedFactor: 3,
  processNoiseStd: 0.002,
  measurementNoiseStd: 0.01,
  stateWeight: 1,
  controlWeight: 0.1,
  controlLimit: 5,
  reference: 1,
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

function methodName(method: string): string {
  if (method === "full_state_lqr") return "LQR, истинное x";
  if (method === "luenberger_lqr") return "LQR + Люенбергер";
  return "LQG";
}

export function OutputFeedbackPanel({ diagram, simulation }: OutputFeedbackPanelProps) {
  const diagramKey = useMemo(() => diagram ? JSON.stringify(diagram) : "", [diagram]);
  const [system, setSystem] = useState<SystemAnalysis | null>(simulation?.system_analysis ?? null);
  const [inputBlockId, setInputBlockId] = useState("");
  const [outputLabel, setOutputLabel] = useState("");
  const [selectedState, setSelectedState] = useState(0);
  const [options, setOptions] = useState<OutputFeedbackOptions>(DEFAULT_OPTIONS);
  const [result, setResult] = useState<OutputFeedbackResponse | null>(null);
  const [error, setError] = useState("");
  const [reportError, setReportError] = useState("");
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

  function updateNumber<K extends keyof OutputFeedbackOptions>(key: K, value: string) {
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
      const response = await runOutputFeedbackExperiment({
        diagram,
        input_block_id: inputBlockId,
        output_label: outputLabel,
        horizon: options.horizon,
        dt: options.dt,
        initial_state_scale: options.initialStateScale,
        observer_speed_factor: options.observerSpeedFactor,
        process_noise_std: options.processNoiseStd,
        measurement_noise_std: options.measurementNoiseStd,
        state_weight: options.stateWeight,
        control_weight: options.controlWeight,
        control_limit: options.controlLimit,
        reference: options.reference,
        seed: 42,
      }, controller.signal);
      setResult(response);
      setReportError("");
    } catch (runError) {
      setError(
        runError instanceof Error && runError.name === "AbortError"
          ? "Эксперимент остановлен по тайм-ауту. Уменьшите горизонт или увеличьте шаг."
          : runError instanceof Error
            ? runError.message
            : "Не удалось выполнить эксперимент управления по выходу."
      );
    } finally {
      window.clearTimeout(timeout);
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setIsRunning(false);
      }
    }
  }

  function showDefenseReport() {
    if (!result || !system) return;
    const opened = openDefenseReport({ system, result });
    setReportError(
      opened
        ? ""
        : "Браузер заблокировал новое окно. Разрешите всплывающие окна для 127.0.0.1 и повторите.",
    );
  }

  if (isAnalyzing) return <p>Проверяем управляемость, наблюдаемость и собираем ZOH-модель…</p>;
  if (!system) return <div className="safe-learning-error" role="alert">{error || "Соберите корректную динамическую схему."}</div>;
  if (system.state_dimension === 0) return <p>LQG неприменим к статической схеме: добавьте динамический объект.</p>;

  const canRun = system.input_dimension > 0 && system.output_dimension > 0 && Boolean(inputBlockId && outputLabel);
  const lqgDesign = result?.designs.find((item) => item.method === "lqg");
  const lqgMetrics = result?.metrics.find((item) => item.method === "lqg");
  const selectedLabel = result?.trace.state_labels[selectedState] ?? `x${selectedState + 1}`;

  return (
    <div className="safe-learning-view output-feedback-view">
      <section className="safe-learning-intro">
        <div>
          <span>Управление по измеряемому выходу</span>
          <h3>LQR, Люенбергер и LQG в одном sampled-data контуре</h3>
        </div>
        <p>
          Эталонный LQR знает истинное <code>x</code>. Реальные варианты используют только выбранный
          <code> Scope</code> и формируют <code>u = −Kx̂ + Nr</code>. Всем контурам задаются одинаковые шумы,
          начальное состояние и ограничение управления.
        </p>
      </section>

      <section className="safe-learning-controls output-feedback-controls">
        <label className="tool-input"><span>Канал управления</span><select value={inputBlockId} onChange={(event) => setInputBlockId(event.target.value)} disabled={isRunning}>{system.input_blocks.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="tool-input"><span>Измеряемый Scope</span><select value={outputLabel} onChange={(event) => setOutputLabel(event.target.value)} disabled={isRunning}>{system.output_labels.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="tool-input"><span>Задание r</span><input type="number" step={0.1} value={options.reference} onChange={(event) => updateNumber("reference", event.target.value)} disabled={isRunning} /></label>
        <label className="tool-input"><span>Горизонт, с</span><input type="number" min={0.2} max={60} step={0.5} value={options.horizon} onChange={(event) => updateNumber("horizon", event.target.value)} disabled={isRunning} /></label>
        <label className="tool-input"><span>Ограничение |u|</span><input type="number" min={0.0001} max={10000} step={0.1} value={options.controlLimit} onChange={(event) => updateNumber("controlLimit", event.target.value)} disabled={isRunning} /></label>
        <button type="button" className="btn btn-primary safe-learning-run" disabled={!canRun || isRunning} onClick={() => void runExperiment()}>{isRunning ? "Замыкаем контуры…" : "Сравнить контуры"}</button>
        {result && <button type="button" className="btn btn-secondary" onClick={showDefenseReport} data-testid="open-defense-report">Сводка для защиты</button>}
      </section>

      <details className="safe-learning-advanced">
        <summary>Дополнительные настройки</summary>
        <div className="safe-learning-controls safe-learning-controls--nested">
          <label className="tool-input"><span>Шаг, с</span><input type="number" min={0.001} max={0.2} step={0.005} value={options.dt} onChange={(event) => updateNumber("dt", event.target.value)} disabled={isRunning} /></label>
          <label className="tool-input"><span>Норма x(0)</span><input type="number" min={0} max={100} step={0.1} value={options.initialStateScale} onChange={(event) => updateNumber("initialStateScale", event.target.value)} disabled={isRunning} /></label>
          <label className="tool-input"><span>Быстродействие L</span><input type="number" min={1.1} max={20} step={0.5} value={options.observerSpeedFactor} onChange={(event) => updateNumber("observerSpeedFactor", event.target.value)} disabled={isRunning} /></label>
          <label className="tool-input"><span>Вес состояния Q</span><input type="number" min={0.0001} max={10000} step={0.1} value={options.stateWeight} onChange={(event) => updateNumber("stateWeight", event.target.value)} disabled={isRunning} /></label>
          <label className="tool-input"><span>Вес управления R</span><input type="number" min={0.0001} max={10000} step={0.05} value={options.controlWeight} onChange={(event) => updateNumber("controlWeight", event.target.value)} disabled={isRunning} /></label>
          <label className="tool-input"><span>σ процесса / шаг</span><input type="number" min={0} max={10} step={0.005} value={options.processNoiseStd} onChange={(event) => updateNumber("processNoiseStd", event.target.value)} disabled={isRunning} /></label>
          <label className="tool-input"><span>σ измерения</span><input type="number" min={0} max={10} step={0.01} value={options.measurementNoiseStd} onChange={(event) => updateNumber("measurementNoiseStd", event.target.value)} disabled={isRunning} /></label>
        </div>
      </details>

      <p className="safe-learning-assumption">
        Смысл для защиты: LQR стабилизирует отклонение, наблюдатель восстанавливает недоступное состояние,
        а статический префильтр <code>N</code> переводит выход к постоянному заданию <code>r</code>.
        Точное слежение гарантируется для номинальной модели без активного насыщения.
      </p>
      {error && <div className="safe-learning-error" role="alert">{error}</div>}
      {reportError && <div className="safe-learning-error" role="alert">{reportError}</div>}

      {result && (
        <>
          <section className="safe-learning-summary">
            <article><span>Ранги C / O</span><strong>{result.model.controllability_rank} / {result.model.observability_rank}</strong><small>порядок модели n = {result.model.state_dimension}</small></article>
            <article><span>ρ LQG-контура</span><strong>{formatNumber(lqgDesign?.spectral_radius)}</strong><small>{lqgDesign?.asymptotically_stable ? "Шур-устойчив" : "неустойчив"}</small></article>
            <article><span>Выход LQG</span><strong>{formatNumber(lqgMetrics?.final_output)}</strong><small>задание r = {formatNumber(result.settings.reference)}</small></article>
            <article><span>Ошибка слежения</span><strong>{formatNumber(lqgMetrics?.steady_state_error)}</strong><small>r − y в конце горизонта</small></article>
            <article><span>Насыщение LQG</span><strong>{formatNumber(lqgMetrics?.saturation_percent, 2)}%</strong><small>|u| ≤ {formatNumber(result.settings.control_limit, 2)}</small></article>
          </section>

          <label className="tool-input observer-state-selector">
            <span>Состояние на графике</span>
            <select value={selectedState} onChange={(event) => setSelectedState(Number(event.target.value))}>
              {result.trace.state_labels.map((label, index) => <option key={`${label}-${index}`} value={index}>{label}</option>)}
            </select>
          </label>

          <section className="safe-learning-plots">
            <article>
              <h3>Отклонение состояния от установившегося режима</h3>
              <Plot data={[
                { x: result.trace.time, y: result.trace.full_state_norm, type: "scatter", mode: "lines", name: "LQR, истинное x", line: { color: "#d9d9d9", width: 2 } },
                { x: result.trace.time, y: result.trace.luenberger_state_norm, type: "scatter", mode: "lines", name: "LQR + Люенбергер", line: { color: "#7e7e7e", width: 1.7, dash: "dot" } },
                { x: result.trace.time, y: result.trace.kalman_state_norm, type: "scatter", mode: "lines", name: "LQG", line: { color: "#da5c2c", width: 2.1 } },
              ]} layout={{ ...plotTheme, yaxis: { ...plotTheme.yaxis, title: "||x − xss||₂" } }} config={{ displayModeBar: false, responsive: true }} style={{ width: "100%", height: "330px" }} useResizeHandler />
            </article>
            <article>
              <h3>Фактически приложенное управление</h3>
              <Plot data={[
                { x: result.trace.time, y: result.trace.time.map(() => result.settings.control_limit), type: "scatter", mode: "lines", name: "+umax", line: { color: "#505050", width: 1, dash: "dash" } },
                { x: result.trace.time, y: result.trace.time.map(() => -result.settings.control_limit), type: "scatter", mode: "lines", name: "−umax", line: { color: "#505050", width: 1, dash: "dash" } },
                { x: result.trace.time, y: result.trace.full_state_control, type: "scatter", mode: "lines", name: "LQR", line: { color: "#d9d9d9", width: 1.6 } },
                { x: result.trace.time, y: result.trace.luenberger_control, type: "scatter", mode: "lines", name: "Люенбергер", line: { color: "#7e7e7e", width: 1.5, dash: "dot" } },
                { x: result.trace.time, y: result.trace.kalman_control, type: "scatter", mode: "lines", name: "LQG", line: { color: "#da5c2c", width: 2 } },
              ]} layout={{ ...plotTheme, yaxis: { ...plotTheme.yaxis, title: "u" } }} config={{ displayModeBar: false, responsive: true }} style={{ width: "100%", height: "330px" }} useResizeHandler />
            </article>
            <article>
              <h3>Истинное и оценённое состояние {selectedLabel} в LQG</h3>
              <Plot data={[
                { x: result.trace.time, y: result.trace.kalman_states[selectedState], type: "scatter", mode: "lines", name: "Истинное x", line: { color: "#d9d9d9", width: 2 } },
                { x: result.trace.time, y: result.trace.kalman_estimates[selectedState], type: "scatter", mode: "lines", name: "Оценка Калмана", line: { color: "#da5c2c", width: 1.9, dash: "dot" } },
              ]} layout={{ ...plotTheme, yaxis: { ...plotTheme.yaxis, title: selectedLabel } }} config={{ displayModeBar: false, responsive: true }} style={{ width: "100%", height: "320px" }} useResizeHandler />
            </article>
            <article>
              <h3>Ошибка оценивания в замкнутом контуре</h3>
              <Plot data={[
                { x: result.trace.time, y: result.trace.luenberger_estimation_error_norm, type: "scatter", mode: "lines", name: "Люенбергер", line: { color: "#7e7e7e", width: 1.7 } },
                { x: result.trace.time, y: result.trace.kalman_estimation_error_norm, type: "scatter", mode: "lines", name: "Калман", line: { color: "#da5c2c", width: 2.1 } },
              ]} layout={{ ...plotTheme, yaxis: { ...plotTheme.yaxis, title: "||x − x̂||₂" } }} config={{ displayModeBar: false, responsive: true }} style={{ width: "100%", height: "320px" }} useResizeHandler />
            </article>
            <article>
              <h3>Выход регулируемого объекта</h3>
              <Plot data={[
                { x: result.trace.time, y: result.trace.time.map(() => result.settings.reference), type: "scatter", mode: "lines", name: "Задание r", line: { color: "#505050", width: 1.2, dash: "dash" } },
                { x: result.trace.time, y: result.trace.full_state_output, type: "scatter", mode: "lines", name: "LQR", line: { color: "#d9d9d9", width: 1.8 } },
                { x: result.trace.time, y: result.trace.luenberger_output, type: "scatter", mode: "lines", name: "Люенбергер", line: { color: "#7e7e7e", width: 1.5, dash: "dot" } },
                { x: result.trace.time, y: result.trace.kalman_output, type: "scatter", mode: "lines", name: "LQG", line: { color: "#da5c2c", width: 2 } },
              ]} layout={{ ...plotTheme, yaxis: { ...plotTheme.yaxis, title: "y" } }} config={{ displayModeBar: false, responsive: true }} style={{ width: "100%", height: "310px" }} useResizeHandler />
            </article>
          </section>

          <section className="safe-learning-table-wrap">
            <h3>Полюса и принцип разделения</h3>
            <table><thead><tr><th>Контур</th><th>K</th><th>Полюса регулятора</th><th>Полюса наблюдателя</th><th>Полюса полной системы</th><th>Проверка</th></tr></thead><tbody>
              {result.designs.map((design) => <tr key={design.method}><td>{design.name}<br /><small>{design.interpretation}</small></td><td><code>{formatMatrix(design.feedback_gain)}</code></td><td><code>{formatPoles(design.controller_poles)}</code></td><td><code>{design.observer_poles.length ? formatPoles(design.observer_poles) : "—"}</code></td><td><code>{formatPoles(design.augmented_poles)}</code></td><td>{design.separation_matches === null ? "эталон" : design.separation_matches ? "совпадает" : "ошибка"}</td></tr>)}
            </tbody></table>
          </section>

          <section className="safe-learning-table-wrap">
            <h3>Сравнение фактических траекторий</h3>
            <table><thead><tr><th>Контур</th><th>RMSE слежения</th><th>Ошибка r − y</th><th>RMS отклонения x</th><th>RMS управления</th><th>Насыщение</th><th>RMSE оценки</th></tr></thead><tbody>
              {result.metrics.map((metric) => <tr key={metric.method}><td>{methodName(metric.method)}</td><td>{formatNumber(metric.tracking_rmse)}</td><td>{formatNumber(metric.steady_state_error)}</td><td>{formatNumber(metric.state_rms)}</td><td>{formatNumber(metric.control_rms)}</td><td>{formatNumber(metric.saturation_percent, 2)}%</td><td>{formatNumber(metric.estimation_rmse)}</td></tr>)}
            </tbody></table>
          </section>

          {result.warnings.length > 0 && <ul className="safe-learning-warnings">{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
        </>
      )}
    </div>
  );
}

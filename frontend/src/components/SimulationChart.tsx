import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Plot from "./Plot";
import { axis, MARKER_COLOR, PLOT_CONFIG, plotLayout, SINGLE_SERIES_COLOR, STATIC_PLOT_CONFIG, seriesColor } from "./plotTheme";
import type { SimulationResponse, SystemAnalysis } from "../types/api";
import { UiIcon } from "./UiIcon";
import { StateSpacePanel } from "./simulation/StateSpacePanel";
import { PoleMap } from "./simulation/PoleMap";
import { PoleSphere } from "./simulation/PoleSphere";
import type { Diagram } from "../types/diagram";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { stabilityPresentation } from "../features/modelingWorkspace";
import { CountUp } from "../features/motion/CountUp";
import { ScrambleText } from "../features/motion/ScrambleText";
import { drawPlotLines } from "../features/motion/drawPlotLines";

interface SimulationChartProps {
  result: SimulationResponse | null;
  /** The last successful run of the same diagram, drawn for comparison. */
  previousResult?: SimulationResponse | null;
  /** A background recomputation during a parameter drag: no entrance animation. */
  live?: boolean;
  /** Root diagram of this result, for the root-locus sweep. */
  diagram?: Diagram | null;
  focusBlockId?: string | null;
  onClose?: () => void;
  requestedTab?: ScopeTab;
  onTabChange?: (tab: ScopeTab) => void;
}

export type ScopeTab = "plot" | "analysis" | "frequency" | "stateSpace";

const TABS: Array<{ id: ScopeTab; label: string }> = [
  { id: "plot", label: "Графики" },
  { id: "analysis", label: "Анализ" },
  { id: "frequency", label: "Частоты" },
  { id: "stateSpace", label: "Матрицы" },
];

function formatOptionalNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return Number.parseFloat(value.toPrecision(5)).toString();
}

function formatReference(value: number | string | null | undefined): string {
  return typeof value === "number" ? formatOptionalNumber(value) : value || "—";
}

function formatPole(pole: { real: number; imag: number }): string {
  const real = pole.real.toFixed(4);
  const imagAbs = Math.abs(pole.imag).toFixed(4);
  if (Math.abs(pole.imag) < 1e-12) {
    return real;
  }
  return `${real} ${pole.imag >= 0 ? "+" : "−"} ${imagAbs}j`;
}

interface PlotClick {
  points?: Array<{ x: number }>;
  event?: MouseEvent;
}

/** y(t) by linear interpolation on the output grid. */
function valueAt(time: number[], values: number[], t: number): number {
  if (time.length === 0) return Number.NaN;
  if (t <= time[0]) return values[0];
  if (t >= time[time.length - 1]) return values[values.length - 1];
  let low = 0;
  let high = time.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (time[middle] <= t) low = middle;
    else high = middle;
  }
  const ratio = (t - time[low]) / (time[high] - time[low]);
  return values[low] + ratio * (values[high] - values[low]);
}

function formatCursor(value: number): string {
  return Number.isFinite(value) ? Number.parseFloat(value.toPrecision(5)).toString() : "—";
}

function solverLabel(result: SimulationResponse): string {
  const used = result.metadata.used_solver;
  return used === "rk4" ? "RK4, постоянный шаг" : used === "static" ? "статическая модель" : "RK45 (solve_ivp)";
}

export function SimulationChart({
  result,
  previousResult = null,
  live = false,
  diagram = null,
  focusBlockId = null,
  onClose,
  requestedTab,
  onTabChange,
}: SimulationChartProps) {
  const [activeTab, setActiveTab] = useState<ScopeTab>(requestedTab ?? "plot");
  const [channelIndex, setChannelIndex] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showPrevious, setShowPrevious] = useState(true);
  // Oscilloscope cursors: click places the first, Shift+click the second.
  const [cursors, setCursors] = useState<[number | null, number | null]>([null, null]);
  const expandedDialogRef = useDialogFocus<HTMLElement>(isExpanded, () => setIsExpanded(false));
  // The time plot draws its lines once per new result, not on resize or tab switches.
  const drawnResultRef = useRef<SimulationResponse | null>(null);

  // Plotly drops plotly_click listeners when it re-creates the plot (react-plotly's onClick is
  // lost the same way), so the listener is (re)attached whenever the pointer enters the plot.
  const placeCursorRef = useRef<(event: PlotClick) => void>(() => {});
  const clickListenerRef = useRef((event: PlotClick) => placeCursorRef.current(event));

  function bindClicks(graph: Element | null) {
    const target = graph as (Element & {
      on?: (name: string, handler: (event: PlotClick) => void) => void;
      _ev?: { listeners: (name: string) => unknown[] };
    }) | null;
    if (!target || typeof target.on !== "function") return;
    if (target._ev?.listeners("plotly_click").includes(clickListenerRef.current)) return;
    target.on("plotly_click", clickListenerRef.current);
  }

  function drawOnce(graph: HTMLElement) {
    bindClicks(graph);
    if (drawnResultRef.current === result) return;
    drawnResultRef.current = result;
    if (live) return;
    // Plotly redraws once more after mounting (resize handler); animate the settled paths.
    window.setTimeout(() => drawPlotLines(graph), 60);
  }

  useEffect(() => {
    if (activeTab === "plot" || activeTab === "frequency") {
      window.dispatchEvent(new Event("resize"));
    }
  }, [activeTab, isExpanded]);

  useEffect(() => {
    if (requestedTab) setActiveTab(requestedTab);
  }, [requestedTab]);

  const comparable = Boolean(
    previousResult?.success
    && result?.success
    && Object.keys(previousResult.outputs).every((label) => label in result.outputs),
  );

  const traces = useMemo(() => {
    if (!result?.success) {
      return [];
    }
    const labels = Object.keys(result.outputs);
    const current = labels.map((label, index) => ({
      x: result.time,
      y: result.outputs[label],
      mode: "lines",
      type: "scatter",
      name: label,
      line: { color: seriesColor(index, labels.length), width: 1.5 },
    }));
    if (!comparable || !showPrevious || !previousResult) {
      return current;
    }
    const previous = labels
      .filter((label) => label in previousResult.outputs)
      .map((label) => ({
        x: previousResult.time,
        y: previousResult.outputs[label],
        mode: "lines",
        type: "scatter",
        name: `${label} · предыдущий расчёт`,
        line: { color: labels.length === 1 ? "#8a8a8a" : seriesColor(labels.indexOf(label), labels.length), width: 1, dash: "dot" },
        opacity: 0.8,
      }));
    return [...previous, ...current];
  }, [result, previousResult, comparable, showPrevious]);

  const probe = useMemo(() => {
    if (!result?.success) return null;
    const label = Object.keys(result.outputs)[0];
    if (!label) return null;
    const values = result.outputs[label];
    const metrics = result.quality_metrics?.[label];
    const read = (t: number | null) => (t === null ? null : { t, y: valueAt(result.time, values, t) });
    return { label, values, metrics, first: read(cursors[0]), second: read(cursors[1]) };
  }, [result, cursors]);

  const cursorTraces = useMemo(() => {
    if (!probe) return [];
    const marks = [];
    if (probe.second) {
      marks.push({
        x: [probe.second.t], y: [probe.second.y], type: "scatter", mode: "markers", hoverinfo: "skip", showlegend: false,
        marker: { size: 8, color: "#000000", line: { color: "#f2f2f2", width: 1 } },
      });
    }
    if (probe.first) {
      marks.push({
        x: [probe.first.t], y: [probe.first.y], type: "scatter", mode: "markers", hoverinfo: "skip", showlegend: false,
        marker: { size: 8, color: MARKER_COLOR },
      });
    }
    return marks;
  }, [probe]);

  const cursorShapes = useMemo(() => {
    const shapes: Record<string, unknown>[] = [];
    const metrics = probe?.metrics;
    if (metrics && metrics.target_value !== null && metrics.target_value !== undefined) {
      const target = metrics.target_value;
      const start = probe.values[0] ?? 0;
      const band = Math.abs(target - start) * 0.02;
      if (band > 0) {
        shapes.push({ type: "rect", xref: "paper", x0: 0, x1: 1, y0: target - band, y1: target + band, fillcolor: "rgba(255,255,255,0.05)", line: { width: 0 }, layer: "below" });
      }
      shapes.push({ type: "line", xref: "paper", x0: 0, x1: 1, y0: target, y1: target, line: { color: "rgba(255,255,255,0.45)", width: 1, dash: "dot" } });
      if (metrics.settling_time !== null && metrics.settling_time !== undefined) {
        const settle = (metrics.step_time ?? 0) + metrics.settling_time;
        shapes.push({ type: "line", yref: "paper", x0: settle, x1: settle, y0: 0, y1: 1, line: { color: "rgba(255,255,255,0.35)", width: 1, dash: "dot" } });
      }
    }
    if (probe?.first) {
      shapes.push({ type: "line", yref: "paper", x0: probe.first.t, x1: probe.first.t, y0: 0, y1: 1, line: { color: "rgba(255,255,255,0.6)", width: 1 } });
    }
    if (probe?.second) {
      shapes.push({ type: "line", yref: "paper", x0: probe.second.t, x1: probe.second.t, y0: 0, y1: 1, line: { color: "rgba(255,255,255,0.6)", width: 1, dash: "dash" } });
    }
    return shapes;
  }, [probe]);

  const settleAnnotation = useMemo(() => {
    const metrics = probe?.metrics;
    if (!metrics || metrics.settling_time === null || metrics.settling_time === undefined) return [];
    return [{
      x: (metrics.step_time ?? 0) + metrics.settling_time, y: 1, xref: "x", yref: "paper", yanchor: "bottom",
      text: "t_рег", showarrow: false, font: { size: 11, color: "#8a8a8a" },
    }];
  }, [probe]);

  function placeCursor(event: PlotClick) {
    const t = event.points?.[0]?.x;
    if (typeof t !== "number") return;
    setCursors((current) => (event.event?.shiftKey ? [current[0], t] : [t, current[1]]));
  }
  placeCursorRef.current = placeCursor;

  function selectTab(tab: ScopeTab) {
    setActiveTab(tab);
    onTabChange?.(tab);
  }

  function timeLayout(extra: Record<string, unknown> = {}) {
    return plotLayout({
      showlegend: traces.length > 1,
      legend: { orientation: "h", x: 0, y: 1.02, yanchor: "bottom", font: { size: 12 } },
      margin: { l: 56, r: 16, b: 44, t: traces.length > 1 ? 32 : 12 },
      xaxis: axis("t, с"),
      yaxis: axis("y(t)"),
      shapes: cursorShapes,
      annotations: settleAnnotation,
      ...extra,
    });
  }

  function renderPlotTab() {
    if (!result?.success) {
      return <p>Запустите моделирование, чтобы увидеть выходные сигналы.</p>;
    }

    return (
      <div
        className="scope-plot scope-plot--full"
        data-testid="plot-ready"
        onPointerEnter={(event) => bindClicks(event.currentTarget.querySelector(".js-plotly-plot"))}
      >
        {probe && (
          <div className="scope-readout" data-testid="cursor-readout">
            {probe.first ? (
              <>
                <span><span className="hud-key">t₁</span> {formatCursor(probe.first.t)}</span>
                <span><span className="hud-key">{probe.label}</span> {formatCursor(probe.first.y)}</span>
                {probe.second && (
                  <>
                    <span><span className="hud-key">t₂</span> {formatCursor(probe.second.t)}</span>
                    <span><span className="hud-key">Δt</span> {formatCursor(probe.second.t - probe.first.t)}</span>
                    <span><span className="hud-key">Δy</span> {formatCursor(probe.second.y - probe.first.y)}</span>
                  </>
                )}
                <button type="button" className="hud-link" onClick={() => setCursors([null, null])}>Сбросить курсоры</button>
              </>
            ) : (
              <span className="scope-readout__hint">Клик по графику — курсор, Shift+клик — второй курсор</span>
            )}
          </div>
        )}
        <Plot
          data={[...traces, ...cursorTraces]}
          layout={timeLayout()}
          config={PLOT_CONFIG}
          style={{ width: "100%", height: "100%", minHeight: "180px" }}
          useResizeHandler
          onInitialized={(_: unknown, graph: HTMLElement) => drawOnce(graph)}
          onUpdate={(_: unknown, graph: HTMLElement) => drawOnce(graph)}
        />
        <footer className="scope-plot__footer">
          <span className="scope-plot__meta" title={`${result.time.length} точек`}>{solverLabel(result)}</span>
          {comparable && (
            <label className="scope-plot__compare">
              <input type="checkbox" checked={showPrevious} onChange={(event) => setShowPrevious(event.target.checked)} />
              Предыдущий расчёт
            </label>
          )}
          {result.warnings.map((warning) => (
            <span key={warning} className="scope-plot__warning" role="note">
              <UiIcon name="info" /> {warning}
            </span>
          ))}
        </footer>
      </div>
    );
  }

  function propertySummary(property: SystemAnalysis["controllability"], full: string): string {
    if (!property.applicable) return "Не применимо к статической модели";
    if (!property.full_rank) return "Неполный ранг (тест PBH)";
    return property.weak ? `${full}, но близка к вырождению` : full;
  }

  function renderAnalysisTab() {
    if (!result || !result.success) {
      return <p>Анализ станет доступен после завершения моделирования.</p>;
    }

    const qualityEntries = Object.entries(result.quality_metrics ?? {});
    const system = result.system_analysis;
    const stability = stabilityPresentation(system?.stability);

    return (
      <div className="scope-analysis">
        <h3>Собранная система</h3>
        {system ? (
          <div className="system-analysis-grid">
            <article className={`system-analysis-card tone-${stability.tone}`} data-testid="system-stability">
              <span>Устойчивость</span>
              <strong><ScrambleText text={stability.label} /></strong>
              <small>{system.stability_reason}</small>
            </article>
            <article className="system-analysis-card">
              <span>Полюса</span>
              <strong><CountUp value={system.poles.length} format={(v) => String(Math.round(v ?? 0))} /></strong>
              <small>{system.poles.length > 0 ? system.poles.map(formatPole).join(", ") : "Статическая модель"}</small>
            </article>
            <article className="system-analysis-card">
              <span>Степень устойчивости</span>
              <strong><CountUp value={system.stability_degree} format={formatOptionalNumber} /></strong>
              <small>α = −max Re(λ)</small>
            </article>
            <article className="system-analysis-card">
              <span>Управляемость</span>
              <strong><CountUp value={system.controllability.rank} format={(v) => String(Math.round(v ?? 0))} /> / {system.state_dimension}</strong>
              <small>{propertySummary(system.controllability, "Полностью управляема")}</small>
            </article>
            <article className="system-analysis-card">
              <span>Наблюдаемость</span>
              <strong><CountUp value={system.observability.rank} format={(v) => String(Math.round(v ?? 0))} /> / {system.state_dimension}</strong>
              <small>{propertySummary(system.observability, "Полностью наблюдаема")}</small>
            </article>
          </div>
        ) : (
          <p>Общая модель системы пока недоступна.</p>
        )}

        {system && (
          <>
            <h3>Полюса: сфера модели и годограф</h3>
            <div className="pole-views">
              <PoleSphere poles={system.poles} />
              <PoleMap poles={system.poles} diagram={diagram} focusBlockId={focusBlockId} />
            </div>
          </>
        )}

        <h3>Показатели качества</h3>
        {qualityEntries.length === 0 ? (
          <p>Выходные сигналы ещё не рассчитаны.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Сигнал</th>
                <th>y(∞)</th>
                <th>y(t_end)</th>
                <th>Перерег., %</th>
                <th>t_рег (2 %), с</th>
                <th>t_нар, с</th>
                <th>Задание</th>
                <th>Стат. ошибка</th>
                <th>IAE</th>
                <th>ISE</th>
              </tr>
            </thead>
            <tbody>
              {qualityEntries.map(([label, metrics]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td title="Установившееся значение по модели: (D − C·A⁻¹·B)·r">{formatOptionalNumber(metrics.target_value)}</td>
                  <td>{formatOptionalNumber(metrics.final_value)}</td>
                  <td>{formatOptionalNumber(metrics.overshoot_percent)}</td>
                  <td>{formatOptionalNumber(metrics.settling_time)}</td>
                  <td>{formatOptionalNumber(metrics.rise_time)}</td>
                  <td>{formatReference(metrics.reference)}</td>
                  <td>{formatOptionalNumber(metrics.steady_state_error)}</td>
                  <td>{formatOptionalNumber(metrics.integral_absolute_error)}</td>
                  <td>{formatOptionalNumber(metrics.integral_squared_error)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {qualityEntries.some(([, metrics]) => metrics.reason) && (
          <ul className="quality-notes">
            {qualityEntries.filter(([, metrics]) => metrics.reason).map(([label, metrics]) => (
              <li key={label}><strong>{label}:</strong> {metrics.reason}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  function renderFrequencyTab() {
    const frequency = result?.frequency_analysis;
    if (!result?.success || !frequency?.available) {
      return (
        <p>{frequency?.reason ?? "Частотные характеристики станут доступны после моделирования LTI-схемы."}</p>
      );
    }

    const omega = frequency.frequency_rad_s ?? [];
    const channels = frequency.channels ?? [];
    const channel = channels[Math.min(channelIndex, channels.length - 1)];
    if (!channel) {
      return <p>Нет каналов вход → выход.</p>;
    }

    return (
      <div className="frequency-view" data-testid="frequency-analysis-ready">
        <header className="frequency-view__header">
          <label className="frequency-channel-picker">
            <span>Канал</span>
            <select value={channels.indexOf(channel)} onChange={(event) => setChannelIndex(Number(event.target.value))}>
              {channels.map((item, index) => (
                <option key={`${item.input_block}-${item.output_label}`} value={index}>
                  {item.input_block} → {item.output_label}
                </option>
              ))}
            </select>
          </label>
        </header>

        <div className="frequency-plot-grid">
          <article className="frequency-plot-card">
            <h3>ЛАЧХ</h3>
            <Plot
              data={[{ x: omega, y: channel.magnitude_db, type: "scatter", mode: "lines", connectgaps: false, line: { color: SINGLE_SERIES_COLOR, width: 1.5 } }]}
              layout={{
                ...plotLayout({ hovermode: "closest", margin: { l: 56, r: 16, b: 44, t: 8 } }),
                xaxis: axis("ω, рад/с", { type: "log" }),
                yaxis: axis("L(ω), дБ"),
              }}
              config={STATIC_PLOT_CONFIG}
              style={{ width: "100%", height: "250px" }}
              useResizeHandler
            />
          </article>

          <article className="frequency-plot-card">
            <h3>ЛФЧХ</h3>
            <Plot
              data={[{ x: omega, y: channel.phase_deg, type: "scatter", mode: "lines", connectgaps: false, line: { color: SINGLE_SERIES_COLOR, width: 1.5 } }]}
              layout={{
                ...plotLayout({ hovermode: "closest", margin: { l: 56, r: 16, b: 44, t: 8 } }),
                xaxis: axis("ω, рад/с", { type: "log" }),
                yaxis: axis("φ(ω), °"),
              }}
              config={STATIC_PLOT_CONFIG}
              style={{ width: "100%", height: "250px" }}
              useResizeHandler
            />
          </article>

          <article className="frequency-plot-card frequency-plot-card--nyquist">
            <h3>АФЧХ</h3>
            <Plot
              data={[{ x: channel.real, y: channel.imag, type: "scatter", mode: "lines", connectgaps: false, line: { color: SINGLE_SERIES_COLOR, width: 1.5 } }]}
              layout={{
                ...plotLayout({ hovermode: "closest", margin: { l: 56, r: 16, b: 44, t: 8 } }),
                xaxis: axis("Re W(jω)", { scaleanchor: "y", scaleratio: 1 }),
                yaxis: axis("Im W(jω)")
              }}
              config={STATIC_PLOT_CONFIG}
              style={{ width: "100%", height: "300px" }}
              useResizeHandler
            />
          </article>
        </div>

        <p className="frequency-interpretation">{frequency.interpretation}</p>
      </div>
    );
  }

  function renderStateSpaceTab() {
    return <StateSpacePanel result={result} />;
  }

  return (
    <>
      <section className="panel chart-panel scope-panel">
        <header className="scope-panel__header">
          <div className="scope-header-actions">
            <nav className="scope-tabs" role="tablist" aria-label="Представление результатов">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  data-testid={`scope-tab-${tab.id}`}
                  className={`hud-tab ${activeTab === tab.id ? "is-active" : ""}`}
                  onClick={() => selectTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </nav>

            {activeTab === "plot" && result?.success && (
              <button
                type="button"
                className="hud-link"
                onClick={() => setIsExpanded(true)}
              >
                На весь экран
              </button>
            )}

            {onClose && (
              <button type="button" className="hud-icon-button" onClick={onClose} aria-label="Свернуть результаты" title="Свернуть результаты">
                <UiIcon name="close" />
              </button>
            )}
          </div>
        </header>

        <div className="scope-content" role="tabpanel" key={activeTab}>
          {activeTab === "plot" && renderPlotTab()}
          {activeTab === "analysis" && renderAnalysisTab()}
          {activeTab === "frequency" && renderFrequencyTab()}
          {activeTab === "stateSpace" && renderStateSpaceTab()}
        </div>
      </section>

      {isExpanded &&
        result?.success &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="modal-overlay modal-overlay--scope-fullscreen"
            onClick={() => setIsExpanded(false)}
          >
            <section
              ref={expandedDialogRef}
              className="scope-expand-modal scope-expand-modal--fullscreen"
              role="dialog"
              aria-modal="true"
              aria-labelledby="scope-fullscreen-title"
              tabIndex={-1}
              onClick={(event) => event.stopPropagation()}
            >
              <header className="scope-expand-modal__header">
                <h3 id="scope-fullscreen-title">Графики</h3>
                <button type="button" className="hud-link" onClick={() => setIsExpanded(false)}>
                  Закрыть
                </button>
              </header>
              <div className="scope-expand-modal__content">
                <Plot
                  data={traces}
                  layout={timeLayout({ margin: { l: 64, r: 24, b: 56, t: 40 } })}
                  config={PLOT_CONFIG}
                  style={{ width: "100%", height: "100%" }}
                  useResizeHandler
                />
              </div>
            </section>
          </div>,
          document.body
        )}
    </>
  );
}

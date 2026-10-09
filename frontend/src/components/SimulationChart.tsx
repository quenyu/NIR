import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Plot from "./Plot";
import { axis, PLOT_CONFIG, plotLayout, SERIES_COLORS, STATIC_PLOT_CONFIG } from "./plotTheme";
import type { SimulationResponse, SystemAnalysis } from "../types/api";
import { UiIcon } from "./UiIcon";
import { StateSpacePanel } from "./simulation/StateSpacePanel";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { stabilityPresentation } from "../features/modelingWorkspace";

interface SimulationChartProps {
  result: SimulationResponse | null;
  /** The last successful run of the same diagram, drawn for comparison. */
  previousResult?: SimulationResponse | null;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
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

function solverLabel(result: SimulationResponse): string {
  const used = result.metadata.used_solver;
  return used === "rk4" ? "RK4, постоянный шаг" : used === "static" ? "статическая модель" : "RK45 (solve_ivp)";
}

export function SimulationChart({
  result,
  previousResult = null,
  collapsed = false,
  onToggleCollapsed,
  requestedTab,
  onTabChange,
}: SimulationChartProps) {
  const [activeTab, setActiveTab] = useState<ScopeTab>(requestedTab ?? "plot");
  const [channelIndex, setChannelIndex] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showPrevious, setShowPrevious] = useState(true);
  const expandedDialogRef = useDialogFocus<HTMLElement>(isExpanded, () => setIsExpanded(false));

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
      line: { color: SERIES_COLORS[index % SERIES_COLORS.length], width: 2 },
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
        line: { color: SERIES_COLORS[labels.indexOf(label) % SERIES_COLORS.length], width: 1.5, dash: "dot" },
        opacity: 0.6,
      }));
    return [...previous, ...current];
  }, [result, previousResult, comparable, showPrevious]);

  function selectTab(tab: ScopeTab) {
    setActiveTab(tab);
    onTabChange?.(tab);
    if (collapsed) {
      onToggleCollapsed?.();
    }
  }

  function timeLayout(extra: Record<string, unknown> = {}) {
    return plotLayout({
      showlegend: traces.length > 1,
      legend: { orientation: "h", x: 0, y: 1.02, yanchor: "bottom", font: { size: 12 } },
      margin: { l: 56, r: 16, b: 44, t: traces.length > 1 ? 32 : 12 },
      xaxis: axis("t, с"),
      yaxis: axis("y(t)"),
      ...extra,
    });
  }

  function renderPlotTab() {
    if (!result?.success) {
      return <p>Запустите моделирование, чтобы увидеть выходные сигналы.</p>;
    }

    return (
      <div className="scope-plot scope-plot--full" data-testid="plot-ready">
        <Plot
          data={traces}
          layout={timeLayout()}
          config={PLOT_CONFIG}
          style={{ width: "100%", height: "100%", minHeight: "180px" }}
          useResizeHandler
        />
        <footer className="scope-plot__footer">
          <span>{solverLabel(result)} · {result.time.length} точек · n = {result.system_analysis?.state_dimension ?? 0}</span>
          {comparable && (
            <label className="scope-plot__compare">
              <input type="checkbox" checked={showPrevious} onChange={(event) => setShowPrevious(event.target.checked)} />
              Показать предыдущий расчёт
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
              <strong>{stability.label}</strong>
              <small>{system.stability_reason}</small>
            </article>
            <article className="system-analysis-card">
              <span>Полюса</span>
              <strong>{system.poles.length}</strong>
              <small>{system.poles.length > 0 ? system.poles.map(formatPole).join(", ") : "Статическая модель"}</small>
            </article>
            <article className="system-analysis-card">
              <span>Степень устойчивости</span>
              <strong>{formatOptionalNumber(system.stability_degree)}</strong>
              <small>α = −max Re(λ)</small>
            </article>
            <article className="system-analysis-card">
              <span>Управляемость</span>
              <strong>{system.controllability.rank} / {system.state_dimension}</strong>
              <small>{propertySummary(system.controllability, "Полностью управляема")}</small>
            </article>
            <article className="system-analysis-card">
              <span>Наблюдаемость</span>
              <strong>{system.observability.rank} / {system.state_dimension}</strong>
              <small>{propertySummary(system.observability, "Полностью наблюдаема")}</small>
            </article>
          </div>
        ) : (
          <p>Общая модель системы пока недоступна.</p>
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
              data={[{ x: omega, y: channel.magnitude_db, type: "scatter", mode: "lines", connectgaps: false, line: { color: SERIES_COLORS[0], width: 2 } }]}
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
              data={[{ x: omega, y: channel.phase_deg, type: "scatter", mode: "lines", connectgaps: false, line: { color: SERIES_COLORS[0], width: 2 } }]}
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
              data={[{ x: channel.real, y: channel.imag, type: "scatter", mode: "lines", connectgaps: false, line: { color: SERIES_COLORS[0], width: 2 } }]}
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
          <h2>Результаты</h2>
          <div className="scope-header-actions">
            <nav className="scope-tabs" role="tablist" aria-label="Представление результатов">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  data-testid={`scope-tab-${tab.id}`}
                  className={`btn btn-tab ${activeTab === tab.id ? "active" : ""}`}
                  onClick={() => selectTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </nav>

            {activeTab === "plot" && result?.success && (
              <button
                type="button"
                className="btn btn-secondary btn-expand"
                onClick={() => setIsExpanded(true)}
              >
                <UiIcon name="expand" />
                На весь экран
              </button>
            )}

            {onToggleCollapsed && (
              <button
                type="button"
                className={`btn btn-quiet scope-collapse-button ${collapsed ? "is-collapsed" : ""}`}
                onClick={onToggleCollapsed}
                aria-expanded={!collapsed}
                title={collapsed ? "Развернуть результаты" : "Свернуть результаты"}
              >
                <UiIcon name="chevron" />
                <span>{collapsed ? "Развернуть" : "Свернуть"}</span>
              </button>
            )}
          </div>
        </header>

        <div className="scope-content" role="tabpanel">
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
                <h3 id="scope-fullscreen-title">Осциллограф — полноэкранный режим</h3>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsExpanded(false)}
                >
                  <UiIcon name="close" />
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

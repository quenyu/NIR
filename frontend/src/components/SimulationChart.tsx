import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Plot from "./Plot";
import { PLOT_FONT_COLOR, PLOT_UI_FONT_FAMILY } from "./plotTypography";
import type { SimulationResponse, SystemAnalysis } from "../types/api";
import { UiIcon } from "./UiIcon";
import { StateSpacePanel } from "./simulation/StateSpacePanel";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { stabilityPresentation } from "../features/modelingWorkspace";

interface SimulationChartProps {
  result: SimulationResponse | null;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  requestedTab?: ScopeTab;
  onTabChange?: (tab: ScopeTab) => void;
}

export type ScopeTab = "plot" | "signals" | "analysis" | "frequency" | "stateSpace" | "meta";

interface SignalStatsRow {
  name: string;
  min: number;
  max: number;
  final: number;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "н/д";
  }
  return value.toFixed(4);
}

function computeSignalStats(result: SimulationResponse): SignalStatsRow[] {
  return Object.entries(result.outputs).map(([name, values]) => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const final = values.length > 0 ? values[values.length - 1] : NaN;
    return { name, min, max, final };
  });
}

function formatOptionalNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(4);
}

function formatReference(value: number | string | null | undefined): string {
  return typeof value === "number" ? formatOptionalNumber(value) : value || "-";
}

function formatPole(pole: { real: number; imag: number }): string {
  const real = pole.real.toFixed(4);
  const imagAbs = Math.abs(pole.imag).toFixed(4);
  if (Math.abs(pole.imag) < 1e-12) {
    return real;
  }
  return `${real} ${pole.imag >= 0 ? "+" : "-"} ${imagAbs}i`;
}

const frequencyPlotTheme = {
  paper_bgcolor: "#000000",
  plot_bgcolor: "#000000",
  font: { color: PLOT_FONT_COLOR, family: PLOT_UI_FONT_FAMILY, size: 14 },
  margin: { l: 58, r: 18, b: 48, t: 34 },
  showlegend: false
};

export function SimulationChart({
  result,
  collapsed = false,
  onToggleCollapsed,
  requestedTab,
  onTabChange,
}: SimulationChartProps) {
  const [activeTab, setActiveTab] = useState<ScopeTab>(requestedTab ?? "plot");
  const [channelIndex, setChannelIndex] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const expandedDialogRef = useDialogFocus<HTMLElement>(isExpanded, () => setIsExpanded(false));

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (activeTab === "plot" || activeTab === "frequency") {
      window.dispatchEvent(new Event("resize"));
    }
  }, [activeTab, isExpanded]);

  useEffect(() => {
    if (requestedTab) setActiveTab(requestedTab);
  }, [requestedTab]);

  const traces = useMemo(() => {
    if (!result || !result.success) {
      return [];
    }
    return Object.entries(result.outputs).map(([label, values]) => ({
      x: result.time,
      y: values,
      mode: "lines",
      type: "scatter",
      name: label
    }));
  }, [result]);

  const signalStats = useMemo(() => {
    if (!result || !result.success) {
      return [];
    }
    return computeSignalStats(result);
  }, [result]);

  function selectTab(tab: ScopeTab) {
    setActiveTab(tab);
    onTabChange?.(tab);
    if (collapsed) {
      onToggleCollapsed?.();
    }
  }

  function renderPlotTab() {
    if (!result || !result.success) {
      return <p>Запустите моделирование, чтобы увидеть выходные сигналы.</p>;
    }

    return (
      <div className="scope-plot scope-plot--full" data-testid="plot-ready">
        <Plot
          data={traces}
          layout={{
            title: "Выходные сигналы",
            paper_bgcolor: "#000000",
            plot_bgcolor: "#000000",
            font: { color: PLOT_FONT_COLOR, family: PLOT_UI_FONT_FAMILY, size: 15 },
            colorway: ["#da5c2c", "#d9d9d9", "#b4b4b4", "#7e7e7e", "#505050"],
            xaxis: {
              title: "Время (с)",
              gridcolor: "#202020",
              zerolinecolor: "#505050",
              automargin: true
            },
            yaxis: {
              title: "Амплитуда",
              gridcolor: "#202020",
              zerolinecolor: "#505050",
              automargin: true
            },
            legend: { orientation: "h", y: -0.2 },
            margin: { l: 62, r: 20, b: 64, t: 44 }
          }}
          config={{ displayModeBar: true, responsive: true }}
          style={{ width: "100%", height: "100%", minHeight: "180px" }}
          useResizeHandler
        />
      </div>
    );
  }

  function renderSignalsTab() {
    if (!result || !result.success) {
      return <p>Сигналы пока не рассчитаны.</p>;
    }
    return (
      <div className="scope-signals-table">
        <table>
          <thead>
            <tr>
              <th>Сигнал</th>
              <th>Отсчётов</th>
              <th>Мин</th>
              <th>Макс</th>
              <th>Финал</th>
            </tr>
          </thead>
          <tbody>
            {signalStats.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>{result.outputs[row.name].length}</td>
                <td>{formatNumber(row.min)}</td>
                <td>{formatNumber(row.max)}</td>
                <td>{formatNumber(row.final)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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

  function renderMetaTab() {
    if (!result || !result.success) {
      return <p>Метаданные моделирования пока недоступны.</p>;
    }
    return (
      <div className="scope-meta">
        <table>
          <tbody>
            {Object.entries(result.metadata).map(([key, value]) => (
              <tr key={key}>
                <th>{key}</th>
                <td>{String(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderStateSpaceTab() {
    return <StateSpacePanel result={result} />;
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
              data={[{ x: omega, y: channel.magnitude_db, type: "scatter", mode: "lines", connectgaps: false, line: { color: "#e2e1dc", width: 2.2 } }]}
              layout={{
                ...frequencyPlotTheme,
                xaxis: { type: "log", title: "ω, рад/с", gridcolor: "#292b2f", zerolinecolor: "#52555a" },
                yaxis: { title: "L(ω), дБ", gridcolor: "#292b2f", zerolinecolor: "#52555a" },
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: "100%", height: "250px" }}
              useResizeHandler
            />
          </article>

          <article className="frequency-plot-card">
            <h3>ЛФЧХ</h3>
            <Plot
              data={[{ x: omega, y: channel.phase_deg, type: "scatter", mode: "lines", connectgaps: false, line: { color: "#9da3aa", width: 2.2 } }]}
              layout={{
                ...frequencyPlotTheme,
                xaxis: { type: "log", title: "ω, рад/с", gridcolor: "#292b2f", zerolinecolor: "#52555a" },
                yaxis: { title: "φ(ω), °", gridcolor: "#292b2f", zerolinecolor: "#52555a" },
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: "100%", height: "250px" }}
              useResizeHandler
            />
          </article>

          <article className="frequency-plot-card frequency-plot-card--nyquist">
            <h3>АФЧХ</h3>
            <Plot
              data={[{ x: channel.real, y: channel.imag, type: "scatter", mode: "lines", connectgaps: false, line: { color: "#d5d5d0", width: 2.2 } }]}
              layout={{
                ...frequencyPlotTheme,
                xaxis: { title: "Re W(jω)", gridcolor: "#292b2f", zerolinecolor: "#52555a", scaleanchor: "y", scaleratio: 1 },
                yaxis: { title: "Im W(jω)", gridcolor: "#292b2f", zerolinecolor: "#52555a" }
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: "100%", height: "300px" }}
              useResizeHandler
            />
          </article>
        </div>

        <p className="frequency-interpretation">{frequency.interpretation}</p>
      </div>
    );
  }

  return (
    <>
      <section className="panel chart-panel scope-panel">
        <header className="scope-panel__header">
          <h2>Осциллограф</h2>
          <div className="scope-header-actions">
            <nav className="scope-tabs" aria-label="Представление результатов">
              <button
                type="button"
                data-testid="scope-tab-plot"
                className={`btn btn-tab ${activeTab === "plot" ? "active" : ""}`}
                onClick={() => selectTab("plot")}
              >
                График
              </button>
              <button
                type="button"
                className={`btn btn-tab ${activeTab === "signals" ? "active" : ""}`}
                onClick={() => selectTab("signals")}
              >
                Сигналы
              </button>
              <button
                type="button"
                className={`btn btn-tab ${activeTab === "analysis" ? "active" : ""}`}
                onClick={() => selectTab("analysis")}
              >
                Анализ
              </button>
              <button
                type="button"
                className={`btn btn-tab ${activeTab === "frequency" ? "active" : ""}`}
                onClick={() => selectTab("frequency")}
              >
                Частоты
              </button>
              <button
                type="button"
                data-testid="scope-tab-state-space"
                className={`btn btn-tab ${activeTab === "stateSpace" ? "active" : ""}`}
                onClick={() => selectTab("stateSpace")}
              >
                Матрицы
              </button>
              <button
                type="button"
                className={`btn btn-tab ${activeTab === "meta" ? "active" : ""}`}
                onClick={() => selectTab("meta")}
              >
                Метаданные
              </button>
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
          {activeTab === "signals" && renderSignalsTab()}
          {activeTab === "analysis" && renderAnalysisTab()}
          {activeTab === "frequency" && renderFrequencyTab()}
          {activeTab === "stateSpace" && renderStateSpaceTab()}
          {activeTab === "meta" && renderMetaTab()}
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
                  layout={{
                    title: "Выходные сигналы",
                    paper_bgcolor: "#000000",
                    plot_bgcolor: "#000000",
                    font: { color: PLOT_FONT_COLOR, family: PLOT_UI_FONT_FAMILY, size: 15 },
                    colorway: ["#da5c2c", "#d9d9d9", "#b4b4b4", "#7e7e7e", "#505050"],
                    xaxis: {
                      title: "Время (с)",
                      gridcolor: "#292b2f",
                      zerolinecolor: "#52555a",
                      automargin: true
                    },
                    yaxis: {
                      title: "Амплитуда",
                      gridcolor: "#292b2f",
                      zerolinecolor: "#52555a",
                      automargin: true
                    },
                    legend: { orientation: "h", y: -0.1 },
                    margin: { l: 58, r: 28, b: 72, t: 52 }
                  }}
                  config={{ displayModeBar: true, responsive: true }}
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

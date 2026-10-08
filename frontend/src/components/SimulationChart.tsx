import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Plot from "./Plot";
import { PLOT_FONT_COLOR, PLOT_UI_FONT_FAMILY } from "./plotTypography";
import type { SimulationResponse } from "../types/api";
import { UiIcon } from "./UiIcon";
import { StateSpacePanel } from "./simulation/StateSpacePanel";
import { useDialogFocus } from "../hooks/useDialogFocus";

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

function stabilityLabel(status: string | undefined): string {
  if (status === "stable") return "Устойчива";
  if (status === "unstable") return "Неустойчива";
  if (status === "marginal") return "На границе";
  return "Не применимо";
}

function formatMargin(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "Не найден";
  }
  return `${value.toFixed(2)} ${unit}`;
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

  function renderAnalysisTab() {
    if (!result || !result.success) {
      return <p>Анализ станет доступен после завершения моделирования.</p>;
    }

    const stabilityItems = result.stability_analysis?.transfer_functions ?? [];
    const qualityEntries = Object.entries(result.quality_metrics ?? {});
    const system = result.system_analysis;

    return (
      <div className="scope-analysis">
        <h3>Собранная система</h3>
        {system ? (
          <div className="system-analysis-grid">
            <article className={`system-analysis-card status-${system.stability}`}>
              <span>Устойчивость</span>
              <strong>{stabilityLabel(system.stability)}</strong>
              <small>{system.poles.length > 0 ? system.poles.map(formatPole).join(", ") : "Статическая модель"}</small>
            </article>
            <article className="system-analysis-card">
              <span>Степень устойчивости</span>
              <strong>{formatOptionalNumber(system.stability_degree)}</strong>
              <small>α = −max Re(λ)</small>
            </article>
            <article className="system-analysis-card">
              <span>Порядок модели</span>
              <strong>{system.state_dimension}</strong>
              <small>{system.input_dimension} входов · {system.output_dimension} выходов</small>
            </article>
            <article className="system-analysis-card">
              <span>Управляемость</span>
              <strong>{system.controllability.rank} / {system.state_dimension}</strong>
              <small>{system.state_dimension === 0 ? "Не применимо к статической модели" : system.controllability.full_rank ? "Полностью управляема" : "Неполный ранг"}</small>
            </article>
            <article className="system-analysis-card">
              <span>Наблюдаемость</span>
              <strong>{system.observability.rank} / {system.state_dimension}</strong>
              <small>{system.state_dimension === 0 ? "Не применимо к статической модели" : system.observability.full_rank ? "Полностью наблюдаема" : "Неполный ранг"}</small>
            </article>
          </div>
        ) : (
          <p>Общая модель системы пока недоступна.</p>
        )}

        <h3>Передаточные функции</h3>
        {stabilityItems.length === 0 ? (
          <p>В схеме нет блоков передаточной функции.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Блок</th>
                <th>Статус</th>
                <th>Полюса</th>
              </tr>
            </thead>
            <tbody>
              {stabilityItems.map((item) => (
                <tr key={item.block_id}>
                  <td>{item.block_id}</td>
                  <td>{item.status}</td>
                  <td>{item.poles.map(formatPole).join(", ") || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h3>Показатели качества</h3>
        {qualityEntries.length === 0 ? (
          <p>Выходные сигналы ещё не рассчитаны.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Сигнал</th>
                <th>Задание</th>
                <th>Цель метрики</th>
                <th>Финал</th>
                <th>Стат. ошибка</th>
                <th>Максимум</th>
                <th>Перерег., %</th>
                <th>Регулир., с</th>
                <th>Нарастание, с</th>
                <th>IAE</th>
                <th>ISE</th>
              </tr>
            </thead>
            <tbody>
              {qualityEntries.map(([label, metrics]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>{formatReference(metrics.reference)}</td>
                  <td title={metrics.target_source ?? undefined}>{formatOptionalNumber(metrics.target_value)}</td>
                  <td>{formatOptionalNumber(metrics.final_value)}</td>
                  <td>{formatOptionalNumber(metrics.steady_state_error)}</td>
                  <td>{formatOptionalNumber(metrics.max_value)}</td>
                  <td>{formatOptionalNumber(metrics.overshoot_percent)}</td>
                  <td>{formatOptionalNumber(metrics.settling_time)}</td>
                  <td>{formatOptionalNumber(metrics.rise_time)}</td>
                  <td>{formatOptionalNumber(metrics.integral_absolute_error)}</td>
                  <td>{formatOptionalNumber(metrics.integral_squared_error)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
    const magnitudeDb = frequency.magnitude_db ?? [];
    const phaseDeg = frequency.phase_deg ?? [];
    const nyquistReal = frequency.nyquist_real ?? [];
    const nyquistImag = frequency.nyquist_imag ?? [];

    return (
      <div className="frequency-view" data-testid="frequency-analysis-ready">
        <header className="frequency-view__header">
          <div>
            <span>Канал анализа</span>
            <strong>{frequency.input_block} → {frequency.output_label}</strong>
          </div>
          <div className="frequency-margin-cards">
            <article>
              <span>Формальный запас по фазе</span>
              <strong>{formatMargin(frequency.critical_phase_margin_deg, "°")}</strong>
            </article>
            <article>
              <span>Формальный запас по амплитуде</span>
              <strong>{formatMargin(frequency.critical_gain_margin_db, "дБ")}</strong>
            </article>
          </div>
        </header>

        {frequency.channel_warning && <p className="frequency-interpretation">{frequency.channel_warning}</p>}

        <div className="frequency-plot-grid">
          <article className="frequency-plot-card">
            <h3>АЧХ · диаграмма Боде</h3>
            <Plot
              data={[{ x: omega, y: magnitudeDb, type: "scatter", mode: "lines", line: { color: "#e2e1dc", width: 2.2 } }]}
              layout={{
                ...frequencyPlotTheme,
                xaxis: { type: "log", title: "ω, рад/с", gridcolor: "#292b2f", zerolinecolor: "#52555a" },
                yaxis: { title: "L(ω), дБ", gridcolor: "#292b2f", zerolinecolor: "#52555a" },
                shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: "#8f9196", width: 1, dash: "dot" } }]
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: "100%", height: "250px" }}
              useResizeHandler
            />
          </article>

          <article className="frequency-plot-card">
            <h3>ФЧХ · диаграмма Боде</h3>
            <Plot
              data={[{ x: omega, y: phaseDeg, type: "scatter", mode: "lines", line: { color: "#9da3aa", width: 2.2 } }]}
              layout={{
                ...frequencyPlotTheme,
                xaxis: { type: "log", title: "ω, рад/с", gridcolor: "#292b2f", zerolinecolor: "#52555a" },
                yaxis: { title: "φ(ω), °", gridcolor: "#292b2f", zerolinecolor: "#52555a" },
                shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: -180, y1: -180, line: { color: "#b99d9f", width: 1, dash: "dot" } }]
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: "100%", height: "250px" }}
              useResizeHandler
            />
          </article>

          <article className="frequency-plot-card frequency-plot-card--nyquist">
            <h3>Годограф Найквиста</h3>
            <Plot
              data={[
                { x: nyquistReal, y: nyquistImag, type: "scatter", mode: "lines", name: "+ω", line: { color: "#d5d5d0", width: 2.2 } },
                { x: [...nyquistReal].reverse(), y: [...nyquistImag].reverse().map((value) => -value), type: "scatter", mode: "lines", name: "−ω", line: { color: "#8b8e93", width: 1.2, dash: "dot" } },
                { x: [-1], y: [0], type: "scatter", mode: "markers", name: "−1 + j0", marker: { color: "#b99d9f", size: 8, symbol: "x" } }
              ]}
              layout={{
                ...frequencyPlotTheme,
                showlegend: true,
                legend: { orientation: "h", x: 0, y: 1.12 },
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

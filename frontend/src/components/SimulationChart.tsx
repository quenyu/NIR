import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Plot from "react-plotly.js";
import type { SimulationResponse } from "../types/api";

interface SimulationChartProps {
  result: SimulationResponse | null;
}

type ScopeTab = "plot" | "signals" | "meta";

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

export function SimulationChart({ result }: SimulationChartProps) {
  const [activeTab, setActiveTab] = useState<ScopeTab>("plot");
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (activeTab === "plot") {
      window.dispatchEvent(new Event("resize"));
    }
  }, [activeTab, isExpanded]);

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
            paper_bgcolor: "#f8fbfe",
            plot_bgcolor: "#eef3f8",
            xaxis: {
              title: "Время (с)",
              gridcolor: "#d2dbe5",
              zerolinecolor: "#8ea1b2"
            },
            yaxis: {
              title: "Амплитуда",
              gridcolor: "#d2dbe5",
              zerolinecolor: "#8ea1b2"
            },
            legend: { orientation: "h", y: -0.2 },
            margin: { l: 54, r: 20, b: 56, t: 40 }
          }}
          config={{ displayModeBar: true, responsive: true }}
          style={{ width: "100%", height: "100%", minHeight: "320px" }}
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

  return (
    <>
      <section className="panel chart-panel scope-panel">
        <header className="scope-panel__header">
          <h2>Осциллограф</h2>
          <div className="scope-header-actions">
            <nav className="scope-tabs">
              <button
                type="button"
                className={`btn btn-tab ${activeTab === "plot" ? "active" : ""}`}
                onClick={() => setActiveTab("plot")}
              >
                График
              </button>
              <button
                type="button"
                className={`btn btn-tab ${activeTab === "signals" ? "active" : ""}`}
                onClick={() => setActiveTab("signals")}
              >
                Сигналы
              </button>
              <button
                type="button"
                className={`btn btn-tab ${activeTab === "meta" ? "active" : ""}`}
                onClick={() => setActiveTab("meta")}
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
                На весь экран
              </button>
            )}
          </div>
        </header>

        <div className="scope-content">
          {activeTab === "plot" && renderPlotTab()}
          {activeTab === "signals" && renderSignalsTab()}
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
              className="scope-expand-modal scope-expand-modal--fullscreen"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="scope-expand-modal__header">
                <h3>Осциллограф - полноэкранный режим</h3>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsExpanded(false)}
                >
                  Закрыть
                </button>
              </header>
              <div className="scope-expand-modal__content">
                <Plot
                  data={traces}
                  layout={{
                    title: "Выходные сигналы",
                    paper_bgcolor: "#f8fbfe",
                    plot_bgcolor: "#eef3f8",
                    xaxis: {
                      title: "Время (с)",
                      gridcolor: "#d2dbe5",
                      zerolinecolor: "#8ea1b2"
                    },
                    yaxis: {
                      title: "Амплитуда",
                      gridcolor: "#d2dbe5",
                      zerolinecolor: "#8ea1b2"
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

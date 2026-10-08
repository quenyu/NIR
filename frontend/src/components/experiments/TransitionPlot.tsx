import Plot from "react-plotly.js";
import { PLOT_FONT_COLOR, PLOT_UI_FONT_FAMILY } from "../plotTypography";
import type { ExperimentRunResponse } from "../../types/experiments";

interface TransitionPlotProps {
  result: ExperimentRunResponse;
}

export function TransitionPlot({ result }: TransitionPlotProps) {
  const traces = [
    result.timeseries.analytic
      ? {
          x: result.timeseries.time,
          y: result.timeseries.analytic,
          mode: "lines",
          type: "scatter",
          name: "analytic",
          line: { dash: "dash", width: 1.4, color: "#606060" }
        }
      : null,
    result.timeseries.rk4
      ? {
          x: result.timeseries.time,
          y: result.timeseries.rk4,
          mode: "lines",
          type: "scatter",
          name: "rk4",
          line: { width: 2, color: "#da5c2c" }
        }
      : null,
    result.timeseries.solve_ivp
      ? {
          x: result.timeseries.time,
          y: result.timeseries.solve_ivp,
          mode: "lines",
          type: "scatter",
          name: "solve_ivp",
          line: { width: 1.8, color: "#d9d9d9" }
        }
      : null
  ].filter(Boolean);

  return (
    <section className="panel experiments-panel">
      <header className="experiments-panel__header">
        <h2>График переходного процесса</h2>
      </header>
      <div className="experiments-plot" data-testid="experiments-transition-plot">
        <Plot
          data={traces}
          layout={{
            title: result.scenario.title,
            paper_bgcolor: "#000000",
            plot_bgcolor: "#000000",
            font: { color: PLOT_FONT_COLOR, family: PLOT_UI_FONT_FAMILY, size: 14 },
            xaxis: { title: "Время (с)", gridcolor: "#292b2f", zerolinecolor: "#52555a" },
            yaxis: { title: "Выход", gridcolor: "#292b2f", zerolinecolor: "#52555a" },
            legend: { orientation: "h", y: -0.18 },
            margin: { l: 54, r: 24, b: 68, t: 52 }
          }}
          config={{ displayModeBar: true, responsive: true }}
          style={{ width: "100%", height: "100%", minHeight: "360px" }}
          useResizeHandler
        />
      </div>
    </section>
  );
}

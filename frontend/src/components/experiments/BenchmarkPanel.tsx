import Plot from "react-plotly.js";
import { PLOT_FONT_COLOR, PLOT_UI_FONT_FAMILY } from "../plotTypography";
import type {
  ExperimentBenchmarkSampleRow,
  ExperimentBenchmarkSummaryRow,
  ExperimentSolver
} from "../../types/experiments";
import { formatFixed } from "./formatting";

interface BenchmarkPanelProps {
  summaryRows: ExperimentBenchmarkSummaryRow[];
  samples: ExperimentBenchmarkSampleRow[];
}

const SOLVER_COLORS: Record<ExperimentSolver, string> = {
  rk4: "#da5c2c",
  solve_ivp: "#d9d9d9"
};

function getHistogramBins(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  if (span <= Number.EPSILON) {
    const padding = Math.max(Math.abs(min) * 0.05, 0.05);
    return {
      start: min - padding,
      end: max + padding,
      size: padding
    };
  }

  const binCount = Math.min(14, Math.max(6, Math.ceil(Math.sqrt(values.length))));
  return {
    start: min,
    end: max,
    size: span / binCount
  };
}

export function BenchmarkPanel({ summaryRows, samples }: BenchmarkPanelProps) {
  if (summaryRows.length === 0 || samples.length === 0) {
    return null;
  }

  const solvers = Array.from(new Set(samples.map((sample) => sample.solver))) as ExperimentSolver[];

  const boxTraces = solvers.map((solver) => ({
    y: samples.filter((sample) => sample.solver === solver).map((sample) => sample.duration_ms),
    type: "box",
    name: solver,
    marker: { color: SOLVER_COLORS[solver] },
    fillcolor: `${SOLVER_COLORS[solver]}22`,
    line: { color: SOLVER_COLORS[solver] },
    boxpoints: "outliers"
  }));

  return (
    <section className="panel experiments-panel" data-testid="experiments-benchmark-panel">
      <header className="experiments-panel__header">
        <h2>Производительность</h2>
      </header>

      <div className="experiments-table-wrap">
        <table className="experiments-table">
          <thead>
            <tr>
              <th>solver</th>
              <th>mean_ms</th>
              <th>median_ms</th>
              <th>std_ms</th>
              <th>min_ms</th>
              <th>max_ms</th>
              <th>N</th>
            </tr>
          </thead>
          <tbody>
            {summaryRows.map((row) => (
              <tr key={row.solver}>
                <td>{row.solver}</td>
                <td>{formatFixed(row.mean_ms)}</td>
                <td>{formatFixed(row.median_ms)}</td>
                <td>{formatFixed(row.std_ms)}</td>
                <td>{formatFixed(row.min_ms)}</td>
                <td>{formatFixed(row.max_ms)}</td>
                <td>{row.repetitions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="experiments-benchmark-plots">
        <div className="experiments-plot">
          <Plot
            data={boxTraces}
            layout={{
              title: "Boxplot времени",
              paper_bgcolor: "#000000",
              plot_bgcolor: "#000000",
              font: { color: PLOT_FONT_COLOR, family: PLOT_UI_FONT_FAMILY, size: 14 },
              yaxis: { title: "Время, мс", gridcolor: "#292b2f", zerolinecolor: "#52555a" },
              margin: { l: 58, r: 18, b: 42, t: 48 }
            }}
            config={{ displayModeBar: true, responsive: true }}
            style={{ width: "100%", height: "100%", minHeight: "320px" }}
            useResizeHandler
          />
        </div>

        <div
          className={`experiments-benchmark-histograms experiments-benchmark-histograms--${Math.min(solvers.length, 2)}`}
          data-testid="experiments-benchmark-histogram"
        >
          {solvers.map((solver) => {
            const solverSamples = samples
              .filter((sample) => sample.solver === solver)
              .map((sample) => sample.duration_ms);
            const bins = getHistogramBins(solverSamples);

            return (
              <div
                key={solver}
                className="experiments-plot experiments-benchmark-histogram-card"
                data-testid={`experiments-benchmark-histogram-${solver}`}
              >
                <Plot
                  data={[
                    {
                      x: solverSamples,
                      type: "histogram",
                      name: solver,
                      opacity: 0.82,
                      marker: { color: SOLVER_COLORS[solver] },
                      xbins: bins,
                      hovertemplate:
                        "solver=" + solver + "<br>duration=%{x:.3f} ms<br>count=%{y}<extra></extra>"
                    }
                  ]}
                  layout={{
                    title: `Распределение времени: ${solver}`,
                    paper_bgcolor: "#000000",
                    plot_bgcolor: "#000000",
                    font: { color: PLOT_FONT_COLOR, family: PLOT_UI_FONT_FAMILY, size: 14 },
                    xaxis: { title: "Время, мс", gridcolor: "#292b2f", zerolinecolor: "#52555a" },
                    yaxis: { title: "Количество", gridcolor: "#292b2f", zerolinecolor: "#52555a" },
                    bargap: 0.08,
                    margin: { l: 58, r: 18, b: 58, t: 48 }
                  }}
                  config={{ displayModeBar: true, responsive: true }}
                  style={{ width: "100%", height: "100%", minHeight: "320px" }}
                  useResizeHandler
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

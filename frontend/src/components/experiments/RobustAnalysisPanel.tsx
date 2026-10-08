import Plot from "react-plotly.js";
import { PLOT_FONT_COLOR, PLOT_UI_FONT_FAMILY } from "../plotTypography";
import type {
  ExperimentMonteCarloSampleRow,
  ExperimentParameterSweepRow,
  ExperimentRobustSummary,
} from "../../types/experiments";

interface RobustAnalysisPanelProps {
  sweepRows: ExperimentParameterSweepRow[];
  monteCarloRows: ExperimentMonteCarloSampleRow[];
  summary: ExperimentRobustSummary | null;
}

function displayNumber(value: number | null, digits = 4): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

const plotLayout = {
  paper_bgcolor: "#000000",
  plot_bgcolor: "#000000",
  font: { color: PLOT_FONT_COLOR, family: PLOT_UI_FONT_FAMILY, size: 14 },
  margin: { l: 58, r: 18, b: 54, t: 28 },
  showlegend: false,
};

export function RobustAnalysisPanel({
  sweepRows,
  monteCarloRows,
  summary,
}: RobustAnalysisPanelProps) {
  if (sweepRows.length === 0 && monteCarloRows.length === 0 && !summary) {
    return null;
  }

  return (
    <section className="panel experiments-panel robust-analysis-panel" data-testid="robust-analysis-panel">
      <header className="experiments-panel__header">
        <div>
          <h2>Параметрические и робастные эксперименты</h2>
          {summary && (
            <p>{summary.parameter_block_id}.{summary.parameter_name} · nominal = {summary.nominal_value}</p>
          )}
        </div>
      </header>

      {summary && (
        <div className="robust-summary-grid">
          <article>
            <span>Робастная устойчивость</span>
            <strong>{summary.robust_stability_percent.toFixed(1)}%</strong>
            <small>{summary.stable_samples} из {summary.sample_count} реализаций</small>
          </article>
          <article>
            <span>Худшая спектральная абсцисса</span>
            <strong>{displayNumber(summary.worst_spectral_abscissa)}</strong>
            <small>Требуется max Re(λ) &lt; 0</small>
          </article>
          <article>
            <span>Диапазон финального значения</span>
            <strong>{displayNumber(summary.final_value_min)}…{displayNumber(summary.final_value_max)}</strong>
            <small>Monte Carlo · {summary.solver}</small>
          </article>
        </div>
      )}

      <div className="robust-plot-grid">
        {sweepRows.length > 0 && (
          <article className="frequency-plot-card">
            <h3>Parameter sweep · спектральная абсцисса</h3>
            <Plot
              data={[{
                x: sweepRows.map((row) => row.parameter_value),
                y: sweepRows.map((row) => row.spectral_abscissa),
                type: "scatter",
                mode: "lines+markers",
                line: { color: "#e2e1dc", width: 2 },
                marker: { color: sweepRows.map((row) => row.stability === "stable" ? "#aab7ae" : "#b99d9f"), size: 7 },
              }]}
              layout={{
                ...plotLayout,
                xaxis: { title: summary?.parameter_name ?? "Параметр", gridcolor: "#292b2f", zerolinecolor: "#52555a" },
                yaxis: { title: "max Re(λ)", gridcolor: "#292b2f", zerolinecolor: "#b99d9f" },
                shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: "#b99d9f", width: 1, dash: "dot" } }],
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: "100%", height: "280px" }}
              useResizeHandler
            />
          </article>
        )}

        {monteCarloRows.length > 0 && (
          <article className="frequency-plot-card">
            <h3>Monte Carlo · параметр → установившееся значение</h3>
            <Plot
              data={[{
                x: monteCarloRows.map((row) => row.parameter_value),
                y: monteCarloRows.map((row) => row.final_value),
                type: "scatter",
                mode: "markers",
                marker: {
                  color: monteCarloRows.map((row) => row.stability === "stable" ? "#aab7ae" : "#b99d9f"),
                  size: 7,
                  opacity: 0.78,
                },
              }]}
              layout={{
                ...plotLayout,
                xaxis: { title: summary?.parameter_name ?? "Параметр", gridcolor: "#292b2f", zerolinecolor: "#52555a" },
                yaxis: { title: "y(∞)", gridcolor: "#292b2f", zerolinecolor: "#52555a" },
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: "100%", height: "280px" }}
              useResizeHandler
            />
          </article>
        )}
      </div>

      {sweepRows.length > 0 && (
        <div className="robust-table-wrap">
          <table className="experiments-table">
            <thead>
              <tr>
                <th>Параметр</th><th>Устойчивость</th><th>max Re(λ)</th>
                <th>Финал</th><th>Перерег., %</th><th>Регулир., с</th><th>IAE</th>
              </tr>
            </thead>
            <tbody>
              {sweepRows.map((row) => (
                <tr key={row.parameter_value}>
                  <td>{row.parameter_value.toPrecision(5)}</td>
                  <td>{row.stability}</td>
                  <td>{displayNumber(row.spectral_abscissa)}</td>
                  <td>{displayNumber(row.final_value)}</td>
                  <td>{displayNumber(row.overshoot_percent, 2)}</td>
                  <td>{displayNumber(row.settling_time, 3)}</td>
                  <td>{displayNumber(row.integral_absolute_error)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

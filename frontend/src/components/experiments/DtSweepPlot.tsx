import Plot from "react-plotly.js";
import { PLOT_FONT_COLOR, PLOT_UI_FONT_FAMILY } from "../plotTypography";
import type { ExperimentDtSweepRow, ExperimentSolver } from "../../types/experiments";
import { formatDtTick } from "./formatting";

interface DtSweepPlotProps {
  rows: ExperimentDtSweepRow[];
}

const SOLVER_COLORS: Record<ExperimentSolver, string> = {
  rk4: "#da5c2c",
  solve_ivp: "#d9d9d9"
};

const DT_TICKS = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2];

function getSafePlotErrors(rows: ExperimentDtSweepRow[]) {
  const positiveValues = rows
    .map((row) => row.max_abs_error)
    .filter((value) => Number.isFinite(value) && value > 0);

  const fallback = positiveValues.length > 0 ? Math.min(...positiveValues) * 0.5 : 1e-16;
  return rows.map((row) => (row.max_abs_error > 0 ? row.max_abs_error : fallback));
}

export function DtSweepPlot({ rows }: DtSweepPlotProps) {
  if (rows.length === 0) {
    return null;
  }

  const safeErrors = getSafePlotErrors(rows);
  const rowsWithSafeErrors = rows.map((row, index) => ({
    ...row,
    safe_max_abs_error: safeErrors[index]
  }));

  const solvers = Array.from(new Set(rows.map((row) => row.solver))) as ExperimentSolver[];
  const traces = solvers.map((solver) => {
    const solverRows = rowsWithSafeErrors
      .filter((row) => row.solver === solver)
      .sort((left, right) => left.dt - right.dt);

    return {
      x: solverRows.map((row) => row.dt),
      y: solverRows.map((row) => row.safe_max_abs_error),
      customdata: solverRows.map((row) => [row.solver, row.max_abs_error]),
      mode: "lines+markers",
      type: "scatter",
      name: solver,
      marker: { size: 8, color: SOLVER_COLORS[solver] },
      line: { color: SOLVER_COLORS[solver], width: 2 },
      hovertemplate:
        "solver=%{customdata[0]}<br>dt=%{x:.3~g}<br>max_abs_error=%{customdata[1]:.3e}<extra></extra>"
    };
  });

  return (
    <section className="panel experiments-panel">
      <header className="experiments-panel__header">
        <h2>График ошибки от dt</h2>
      </header>
      <div className="experiments-plot" data-testid="experiments-dt-sweep-plot">
        <Plot
          data={traces}
          layout={{
            paper_bgcolor: "#000000",
            plot_bgcolor: "#000000",
            font: { color: PLOT_FONT_COLOR, family: PLOT_UI_FONT_FAMILY, size: 14 },
            xaxis: {
              title: "Шаг dt",
              type: "log",
              gridcolor: "#292b2f",
              zerolinecolor: "#52555a",
              tickmode: "array",
              tickvals: DT_TICKS,
              ticktext: DT_TICKS.map(formatDtTick),
              minor: { showgrid: false }
            },
            yaxis: {
              title: "Максимальная абсолютная ошибка",
              type: "log",
              gridcolor: "#292b2f",
              zerolinecolor: "#52555a",
              exponentformat: "e"
            },
            hovermode: "closest",
            legend: { orientation: "h", y: -0.18 },
            margin: { l: 72, r: 24, b: 72, t: 28 }
          }}
          config={{ displayModeBar: true, responsive: true }}
          style={{ width: "100%", height: "100%", minHeight: "340px" }}
          useResizeHandler
        />
      </div>
    </section>
  );
}

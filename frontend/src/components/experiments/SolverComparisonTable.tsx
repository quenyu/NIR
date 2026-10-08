import type { ExperimentSolverComparisonRow } from "../../types/experiments";
import { formatScientific } from "./formatting";

interface SolverComparisonTableProps {
  rows: ExperimentSolverComparisonRow[];
}

export function SolverComparisonTable({ rows }: SolverComparisonTableProps) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <section className="panel experiments-panel" data-testid="experiments-comparison-table">
      <header className="experiments-panel__header">
        <h2>Сравнение solver-ов</h2>
      </header>
      <div className="experiments-table-wrap">
        <table className="experiments-table">
          <thead>
            <tr>
              <th>max_abs_diff</th>
              <th>rmse_diff</th>
              <th>final_value_diff</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.max_abs_diff}-${index}`}>
                <td>{formatScientific(row.max_abs_diff)}</td>
                <td>{formatScientific(row.rmse_diff)}</td>
                <td>{formatScientific(row.final_value_diff)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

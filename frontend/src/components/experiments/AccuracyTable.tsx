import type { ExperimentAccuracyRow } from "../../types/experiments";
import { formatScientific } from "./formatting";

interface AccuracyTableProps {
  rows: ExperimentAccuracyRow[];
}

export function AccuracyTable({ rows }: AccuracyTableProps) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <section className="panel experiments-panel" data-testid="experiments-accuracy-table">
      <header className="experiments-panel__header">
        <h2>Таблица ошибок</h2>
      </header>
      <div className="experiments-table-wrap">
        <table className="experiments-table">
          <thead>
            <tr>
              <th>solver</th>
              <th>dt</th>
              <th>max_abs_error</th>
              <th>rmse</th>
              <th>final_value_error</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.solver}-${row.dt}`}>
                <td>{row.solver}</td>
                <td>{formatScientific(row.dt)}</td>
                <td>{formatScientific(row.max_abs_error)}</td>
                <td>{formatScientific(row.rmse)}</td>
                <td>{formatScientific(row.final_value_error)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

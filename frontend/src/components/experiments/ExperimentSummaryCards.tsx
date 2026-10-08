import type { ExperimentRunResponse } from "../../types/experiments";
import { formatCompact, formatFixed, formatScientific } from "./formatting";

interface ExperimentSummaryCardsProps {
  result: ExperimentRunResponse;
  onDownloadJson: () => void;
  onDownloadCsv: () => void;
}

function getBestBenchmarkRow(result: ExperimentRunResponse) {
  if (result.benchmark_summary_rows.length === 0) {
    return null;
  }
  return [...result.benchmark_summary_rows].sort((left, right) => left.median_ms - right.median_ms)[0];
}

function getMaxObservedError(result: ExperimentRunResponse) {
  const values = [
    ...result.accuracy_rows.map((row) => row.max_abs_error),
    ...result.dt_sweep_rows.map((row) => row.max_abs_error)
  ].filter((value) => Number.isFinite(value));

  if (values.length === 0) {
    return null;
  }
  return Math.max(...values);
}

function getModeLabels(result: ExperimentRunResponse): string[] {
  const labels: string[] = [];

  if (result.accuracy_rows.length > 0) {
    labels.push("точность");
  }
  if (result.solver_comparison_rows.length > 0) {
    labels.push("сравнение методов");
  }
  if (result.dt_sweep_rows.length > 0) {
    labels.push("серия по dt");
  }
  if (result.benchmark_summary_rows.length > 0) {
    labels.push("производительность");
  }

  return labels;
}

export function ExperimentSummaryCards({
  result,
  onDownloadJson,
  onDownloadCsv
}: ExperimentSummaryCardsProps) {
  const bestBenchmarkRow = getBestBenchmarkRow(result);
  const maxObservedError = getMaxObservedError(result);
  const modeLabels = getModeLabels(result);

  return (
    <section className="experiments-summary-section">
      <header className="experiments-panel__header">
        <h2>Сводка</h2>
        <div className="experiments-summary__actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onDownloadJson}
            data-testid="experiments-download-json"
          >
            Скачать JSON
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onDownloadCsv}
            data-testid="experiments-download-csv"
          >
            Скачать CSV
          </button>
        </div>
      </header>

      <div className="experiments-summary" data-testid="experiments-summary-cards">
        <article className="panel experiments-summary__card">
          <h3>Сценарий</h3>
          <p>{result.scenario.title}</p>
          <small>{result.scenario.slug}</small>
        </article>

        <article className="panel experiments-summary__card">
          <h3>Численные методы</h3>
          <p>{result.scenario.selected_solvers.join(", ")}</p>
          <small>Активные методы интегрирования</small>
        </article>

        <article className="panel experiments-summary__card">
          <h3>Параметры</h3>
          <p>
            dt = {formatCompact(result.scenario.requested_dt)}, t_end ={" "}
            {formatCompact(result.scenario.requested_t_end)}
          </p>
          <small>Шаг сетки вывода и горизонт моделирования</small>
        </article>

        <article className="panel experiments-summary__card">
          <h3>Окружение</h3>
          <p>{result.environment.python_version}</p>
          <small>
            {result.environment.platform} · {result.environment.generated_at_utc}
          </small>
        </article>

        <article className="panel experiments-summary__card">
          <h3>Лучшее медианное время</h3>
          <p>{bestBenchmarkRow ? bestBenchmarkRow.solver : "н/д"}</p>
          <small>
            {bestBenchmarkRow
              ? `${formatFixed(bestBenchmarkRow.median_ms, 3)} ms`
              : "Сравнение времени не запускалось"}
          </small>
        </article>

        <article className="panel experiments-summary__card">
          <h3>Максимальная ошибка</h3>
          <p>{maxObservedError !== null ? formatScientific(maxObservedError) : "н/д"}</p>
          <small>По оценке точности и серии по dt</small>
        </article>

        <article className="panel experiments-summary__card">
          <h3>Выбранные режимы</h3>
          <div className="experiments-badges">
            {modeLabels.length > 0 ? (
              modeLabels.map((label) => (
                <span key={label} className="experiments-badge">
                  {label}
                </span>
              ))
            ) : (
              <span className="experiments-badge experiments-badge--muted">только переходный процесс</span>
            )}
          </div>
        </article>

        <article className="panel experiments-summary__card">
          <h3>Об измерении времени</h3>
          <p>{result.benchmark_summary_rows.length > 0 ? "Полный цикл backend" : "Измерение выключено"}</p>
          <small>
            {result.benchmark_summary_rows.length > 0
              ? "Время включает компиляцию, solver и формирование outputs."
              : "Локальное сравнение времени не выполнялось."}
          </small>
        </article>
      </div>
    </section>
  );
}

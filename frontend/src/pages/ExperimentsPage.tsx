import { useEffect, useState } from "react";
import { AccuracyTable } from "../components/experiments/AccuracyTable";
import { BenchmarkPanel } from "../components/experiments/BenchmarkPanel";
import { DtSweepPlot } from "../components/experiments/DtSweepPlot";
import { downloadExperimentResultJson, downloadExperimentSummaryCsv } from "../components/experiments/export";
import { ExperimentSummaryCards } from "../components/experiments/ExperimentSummaryCards";
import { ExperimentsControls } from "../components/experiments/ExperimentsControls";
import { SolverComparisonTable } from "../components/experiments/SolverComparisonTable";
import { TransitionPlot } from "../components/experiments/TransitionPlot";
import { RobustAnalysisPanel } from "../components/experiments/RobustAnalysisPanel";
import { useExperimentsRunner } from "../hooks/useExperimentsRunner";
import { UiIcon } from "../components/UiIcon";

type ExperimentResultTab = "overview" | "accuracy" | "robustness" | "benchmark";

function simplifyNote(message: string): string {
  const normalized = message.trim().replace(/\s+/g, " ");

  if (normalized.includes("solve_ivp") && normalized.includes("dt")) {
    return "Для solve_ivp параметр dt задаёт сетку вывода, а не внутренний адаптивный шаг.";
  }
  if (normalized.includes("текущей машине") || normalized.includes("трактовать локально")) {
    return "Benchmark относится к текущей машине и окружению.";
  }
  if (normalized.includes("полный backend pipeline") || normalized.includes("solver kernel")) {
    return "Benchmark измеряет полный backend pipeline, а не только solver kernel.";
  }
  if (normalized.includes("четыре эталонные схемы")) {
    return "Покрыты только 4 эталонных сценария из ограниченной библиотеки блоков.";
  }
  if (
    normalized.includes("Сравнение solver-ов") &&
    normalized.includes("rk4") &&
    normalized.includes("solve_ivp")
  ) {
    return "Сравнение solver-ов доступно только при выборе и rk4, и solve_ivp.";
  }

  return normalized;
}

function dedupeMessages(messages: string[]): string[] {
  return Array.from(new Set(messages.map(simplifyNote)));
}

export function ExperimentsPage() {
  const {
    catalog,
    formState,
    result,
    error,
    isLoadingCatalog,
    isRunning,
    elapsedSeconds,
    updateField,
    toggleSolver,
    runCurrentExperiment,
    resetToDefaults,
    selectScenario
  } = useExperimentsRunner();
  const [activeResultTab, setActiveResultTab] = useState<ExperimentResultTab>("overview");

  useEffect(() => {
    setActiveResultTab("overview");
  }, [result?.environment.generated_at_utc]);

  const warnings = result ? dedupeMessages(result.warnings) : [];
  const interpretationNotes = result ? dedupeMessages(result.interpretation_notes) : [];

  return (
    <main className="experiments-root">
      <a className="skip-link" href="#experiments-results">К результатам эксперимента</a>
      <header className="app-header experiments-header">
        <div className="app-brand">
          <span className="app-brand__mark" aria-hidden="true">△</span>
          <div><strong>CONTROL LAB</strong><span>EXPERIMENTS</span></div>
        </div>
        <div className="experiments-header__context">
          <span>Исследовательский стенд</span>
          <h1>Численные эксперименты</h1>
        </div>
        <nav className="app-nav" aria-label="Основная навигация">
          <a href="/" className="app-nav__link"><UiIcon name="blocks" />Редактор</a>
          <a href="/experiments" className="app-nav__link is-active" aria-current="page"><UiIcon name="flask" />Эксперименты</a>
        </nav>
        <div className="experiments-header__meta">
          <span className="status-dot is-ready" aria-hidden="true" />
          <span>Backend готов</span>
        </div>
      </header>

      <section className="experiments-layout">
        <aside className="experiments-control-rail" aria-label="Параметры эксперимента">
          <div className="experiments-control-rail__intro">
            <span>EXPERIMENT / SETUP</span>
            <p>Точность, устойчивость и производительность вычислительного ядра.</p>
          </div>
          {isLoadingCatalog && (
            <section className="panel">
              <h2>Загрузка</h2>
              <p>Загружается каталог доступных экспериментальных сценариев.</p>
            </section>
          )}

          {!isLoadingCatalog && catalog && formState && (
            <ExperimentsControls
              catalog={catalog}
              formState={formState}
              isRunning={isRunning}
              elapsedSeconds={elapsedSeconds}
              onFieldChange={updateField}
              onScenarioChange={selectScenario}
              onToggleSolver={toggleSolver}
              onRun={runCurrentExperiment}
              onReset={resetToDefaults}
            />
          )}
        </aside>

        <section id="experiments-results" className="experiments-results" tabIndex={-1}>
          <header className="experiments-results__header">
            <div><span>RESULTS / ANALYSIS</span><h2>Результаты вычислений</h2></div>
            <small>{result ? "Данные актуальны для последнего запуска" : "Ожидается запуск сценария"}</small>
          </header>

        {error && (
          <section className="panel error-panel" data-testid="experiments-error-panel" role="alert">
            <h2>Ошибка запроса</h2>
            <p>{error}</p>
            <p className="experiments-error-help">
              Проверьте параметры запуска и доступность backend на `http://127.0.0.1:8000`.
            </p>
          </section>
        )}

        {isRunning && (
          <section className="panel experiments-loading-panel" data-testid="experiments-loading-panel">
            <div className="experiments-state-copy">
              <div className="experiments-run-state">
                <span className="experiments-run-state__spinner" aria-hidden="true" />
                <strong>Расчёт выполняется · {elapsedSeconds} с</strong>
              </div>
              <p>
                Страница остаётся рабочей. Повторный запуск заблокирован до получения ответа
                от вычислительного ядра.
              </p>
            </div>
            <figure className="experiments-processing-visual" aria-hidden="true">
              <img src="/axiom-processing-strip.png" alt="" />
            </figure>
          </section>
        )}

        {!result && !error && !isLoadingCatalog && !isRunning && (
          <section className="panel experiments-empty-state">
            <div className="experiments-state-copy">
              <span>READY / WAITING</span>
              <h2>Результаты появятся после запуска</h2>
              <p>
                Выберите сценарий и запустите расчёт. Здесь появятся переходный процесс,
                показатели точности, устойчивости и времени выполнения.
              </p>
            </div>
            <figure className="experiments-analysis-visual" aria-hidden="true">
              <img src="/axiom-experiment-analysis.png" alt="" />
            </figure>
          </section>
        )}

        {result && (
          <>
            <ExperimentSummaryCards
              result={result}
              onDownloadJson={() => downloadExperimentResultJson(result)}
              onDownloadCsv={() => downloadExperimentSummaryCsv(result)}
            />

            <nav className="panel experiments-result-tabs" aria-label="Разделы результатов" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeResultTab === "overview"}
                className={activeResultTab === "overview" ? "is-active" : ""}
                onClick={() => setActiveResultTab("overview")}
                data-testid="experiments-result-tab-overview"
              >
                Обзор
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeResultTab === "accuracy"}
                className={activeResultTab === "accuracy" ? "is-active" : ""}
                onClick={() => setActiveResultTab("accuracy")}
                disabled={result.accuracy_rows.length === 0 && result.dt_sweep_rows.length === 0}
                data-testid="experiments-result-tab-accuracy"
              >
                Точность и dt
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeResultTab === "robustness"}
                className={activeResultTab === "robustness" ? "is-active" : ""}
                onClick={() => setActiveResultTab("robustness")}
                disabled={
                  result.parameter_sweep_rows.length === 0 &&
                  result.monte_carlo_rows.length === 0 &&
                  !result.robust_summary
                }
                data-testid="experiments-result-tab-robustness"
              >
                Робастность
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeResultTab === "benchmark"}
                className={activeResultTab === "benchmark" ? "is-active" : ""}
                onClick={() => setActiveResultTab("benchmark")}
                disabled={result.benchmark_summary_rows.length === 0}
                data-testid="experiments-result-tab-benchmark"
              >
                Производительность
              </button>
            </nav>

            <div className="experiments-result-view" role="tabpanel">
              {activeResultTab === "overview" && (
                <>
                  <TransitionPlot result={result} />
                  <SolverComparisonTable rows={result.solver_comparison_rows} />

                  <section className="panel experiments-panel">
                    <header className="experiments-panel__header">
                      <h2>Интерпретация результатов</h2>
                    </header>

                    {warnings.length > 0 && (
                      <div className="experiments-notes-block">
                        <h3>Предупреждения</h3>
                        <ul className="experiments-notes-list">
                          {warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {interpretationNotes.length > 0 && (
                      <div className="experiments-notes-block">
                        <h3>Ограничения интерпретации</h3>
                        <ul className="experiments-notes-list">
                          {interpretationNotes.map((note) => (
                            <li key={note}>{note}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>
                </>
              )}

              {activeResultTab === "accuracy" && (
                <>
                  <AccuracyTable rows={result.accuracy_rows} />
                  <DtSweepPlot rows={result.dt_sweep_rows} />
                </>
              )}

              {activeResultTab === "robustness" && (
                <RobustAnalysisPanel
                  sweepRows={result.parameter_sweep_rows}
                  monteCarloRows={result.monte_carlo_rows}
                  summary={result.robust_summary}
                />
              )}

              {activeResultTab === "benchmark" && (
                <BenchmarkPanel
                  summaryRows={result.benchmark_summary_rows}
                  samples={result.benchmark_samples}
                />
              )}
            </div>
          </>
        )}
        </section>
      </section>
    </main>
  );
}

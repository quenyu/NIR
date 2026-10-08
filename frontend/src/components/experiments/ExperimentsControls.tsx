import type { ChangeEvent } from "react";
import type {
  ExperimentCatalogResponse,
  ExperimentFormState,
  ExperimentSolver
} from "../../types/experiments";

interface ExperimentsControlsProps {
  catalog: ExperimentCatalogResponse;
  formState: ExperimentFormState;
  isRunning: boolean;
  elapsedSeconds: number;
  onFieldChange: <K extends keyof ExperimentFormState>(
    field: K,
    value: ExperimentFormState[K]
  ) => void;
  onScenarioChange: (slug: string) => void;
  onToggleSolver: (solver: ExperimentSolver) => void;
  onRun: () => void;
  onReset: () => void;
}

export function ExperimentsControls({
  catalog,
  formState,
  isRunning,
  elapsedSeconds,
  onFieldChange,
  onScenarioChange,
  onToggleSolver,
  onRun,
  onReset
}: ExperimentsControlsProps) {
  const onNumberChange =
    (field: "dt" | "tEnd" | "benchmarkRepetitions" | "benchmarkWarmup" | "monteCarloSamples" | "uncertaintyPercent") =>
    (event: ChangeEvent<HTMLInputElement>) => {
      onFieldChange(field, Number(event.target.value));
    };

  return (
    <section className="panel experiments-controls" aria-busy={isRunning}>
      <div className="experiments-controls__header">
        <div>
          <h2>Панель управления экспериментом</h2>
          <p>
            Выберите сценарий, solver-ы и набор расчётов. По кнопке запускается только
            заранее определённый backend experiment flow.
          </p>
        </div>
        <div className="experiments-controls__actions">
          {isRunning && (
            <div className="experiments-run-state" data-testid="experiments-running-indicator">
              <span className="experiments-run-state__spinner" aria-hidden="true" />
              <span>Расчёт выполняется · {elapsedSeconds} с</span>
            </div>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onReset}
            disabled={isRunning}
          >
            Сбросить к дефолтным параметрам
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onRun}
            disabled={isRunning}
            data-testid="experiments-run-button"
          >
            {isRunning ? "Запуск..." : "Запустить эксперимент"}
          </button>
        </div>
      </div>

      <div className="experiments-controls__grid">
        <label className="tool-input">
          <span>Сценарий</span>
          <select
            value={formState.scenario}
            onChange={(event) => onScenarioChange(event.target.value)}
            disabled={isRunning}
          >
            {catalog.scenarios.map((scenario) => (
              <option key={scenario.slug} value={scenario.slug}>
                {scenario.title}
              </option>
            ))}
          </select>
        </label>

        <label className="tool-input">
          <span>dt</span>
          <input
            type="number"
            step="0.001"
            value={formState.dt}
            onChange={onNumberChange("dt")}
            disabled={isRunning}
          />
        </label>

        <label className="tool-input">
          <span>t_end</span>
          <input
            type="number"
            step="0.1"
            value={formState.tEnd}
            onChange={onNumberChange("tEnd")}
            disabled={isRunning}
          />
        </label>

        <label className="tool-input">
          <span>dt_values</span>
          <input
            type="text"
            value={formState.dtValuesText}
            onChange={(event) => onFieldChange("dtValuesText", event.target.value)}
            placeholder="0.2, 0.1, 0.05, 0.02"
            disabled={isRunning || !formState.runDtSweep}
          />
        </label>

        <label className="tool-input">
          <span>Повторы benchmark</span>
          <input
            type="number"
            min={1}
            value={formState.benchmarkRepetitions}
            onChange={onNumberChange("benchmarkRepetitions")}
            disabled={isRunning || !formState.runBenchmark}
          />
        </label>

        <label className="tool-input">
          <span>Прогрев benchmark</span>
          <input
            type="number"
            min={0}
            value={formState.benchmarkWarmup}
            onChange={onNumberChange("benchmarkWarmup")}
            disabled={isRunning || !formState.runBenchmark}
          />
        </label>

        <label className="tool-input">
          <span>Значения параметра</span>
          <input
            type="text"
            value={formState.parameterValuesText}
            onChange={(event) => onFieldChange("parameterValuesText", event.target.value)}
            placeholder="0.6, 0.8, 1.0, 1.2"
            disabled={isRunning || !formState.runParameterSweep}
          />
        </label>

        <label className="tool-input">
          <span>Monte Carlo, выборок</span>
          <input
            type="number"
            min={1}
            max={500}
            value={formState.monteCarloSamples}
            onChange={onNumberChange("monteCarloSamples")}
            disabled={isRunning || !formState.runMonteCarlo}
          />
        </label>

        <label className="tool-input">
          <span>Неопределённость, ±%</span>
          <input
            type="number"
            min={0.1}
            max={200}
            step={1}
            value={formState.uncertaintyPercent}
            onChange={onNumberChange("uncertaintyPercent")}
            disabled={isRunning || !formState.runMonteCarlo}
          />
        </label>
      </div>

      <div className="experiments-controls__toggles">
        <section className="experiments-controls__group">
          <h3>Численные методы</h3>
          <div className="experiments-checkbox-list">
            {catalog.solvers.map((solver) => (
              <label key={solver} className="experiments-checkbox">
                <input
                  type="checkbox"
                  checked={formState.solvers.includes(solver)}
                  onChange={() => onToggleSolver(solver)}
                  disabled={isRunning}
                />
                <span>{solver}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="experiments-controls__group">
          <h3>Режимы</h3>
          <div className="experiments-checkbox-list">
            <label className="experiments-checkbox">
              <input
                type="checkbox"
                checked={formState.includeAnalytic}
                onChange={(event) => onFieldChange("includeAnalytic", event.target.checked)}
                disabled={isRunning}
              />
              <span>Аналитическое решение</span>
            </label>
            <label className="experiments-checkbox">
              <input
                type="checkbox"
                checked={formState.runAccuracy}
                onChange={(event) => onFieldChange("runAccuracy", event.target.checked)}
                disabled={isRunning}
              />
              <span>Оценка точности</span>
            </label>
            <label className="experiments-checkbox">
              <input
                type="checkbox"
                checked={formState.runSolverComparison}
                onChange={(event) => onFieldChange("runSolverComparison", event.target.checked)}
                disabled={isRunning}
              />
              <span>Сравнение методов</span>
            </label>
            <label className="experiments-checkbox">
              <input
                type="checkbox"
                checked={formState.runDtSweep}
                onChange={(event) => onFieldChange("runDtSweep", event.target.checked)}
                disabled={isRunning}
              />
              <span>Серия по dt</span>
            </label>
            <label className="experiments-checkbox">
              <input
                type="checkbox"
                checked={formState.runBenchmark}
                onChange={(event) => onFieldChange("runBenchmark", event.target.checked)}
                disabled={isRunning}
              />
              <span>Производительность</span>
            </label>
            <label className="experiments-checkbox">
              <input
                type="checkbox"
                checked={formState.runParameterSweep}
                onChange={(event) => onFieldChange("runParameterSweep", event.target.checked)}
                disabled={isRunning}
              />
              <span>Серия по параметру</span>
            </label>
            <label className="experiments-checkbox">
              <input
                type="checkbox"
                checked={formState.runMonteCarlo}
                onChange={(event) => onFieldChange("runMonteCarlo", event.target.checked)}
                disabled={isRunning}
              />
              <span>Monte Carlo / робастность</span>
            </label>
          </div>
        </section>
      </div>
    </section>
  );
}

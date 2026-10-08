import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeDiagram, runSafeControllerLearning } from "../../api/client";
import type { SafeLearningResponse, SimulationResponse, SystemAnalysis } from "../../types/api";
import type { Diagram } from "../../types/diagram";
import Plot from "../Plot";
import { PLOT_FONT_COLOR, PLOT_UI_FONT_FAMILY } from "../plotTypography";

interface SafeLearningPanelProps {
  diagram: Diagram | null;
  simulation: SimulationResponse | null;
}

interface LearningOptions {
  horizon: number;
  dt: number;
  trainingTrajectories: number;
  validationTrajectories: number;
  initialStateScale: number;
  stateNoiseStd: number;
  safetyDecay: number;
  inputLimit: number;
  mpcHorizonSteps: number;
  onPolicyRounds: number;
  onPolicyTrajectories: number;
}

const DEFAULT_OPTIONS: LearningOptions = {
  horizon: 6,
  dt: 0.02,
  trainingTrajectories: 12,
  validationTrajectories: 32,
  initialStateScale: 1,
  stateNoiseStd: 0.04,
  safetyDecay: 0.05,
  inputLimit: 0.5,
  mpcHorizonSteps: 20,
  onPolicyRounds: 2,
  onPolicyTrajectories: 4
};

const plotTheme = {
  paper_bgcolor: "#000000",
  plot_bgcolor: "#000000",
  font: { color: PLOT_FONT_COLOR, family: PLOT_UI_FONT_FAMILY, size: 13 },
  margin: { l: 62, r: 18, b: 52, t: 38 },
  legend: { orientation: "h" as const, y: -0.2 },
  xaxis: { title: "Время, с", gridcolor: "#202020", zerolinecolor: "#505050" },
  yaxis: { gridcolor: "#202020", zerolinecolor: "#505050" }
};

function formatNumber(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return "н/д";
  if (Math.abs(value) > 0 && (Math.abs(value) < 1e-3 || Math.abs(value) >= 1e4)) {
    return value.toExponential(2);
  }
  return value.toFixed(digits);
}

function formatGain(gain: number[][]): string {
  const row = gain[0] ?? [];
  return `[${row.map((value) => formatNumber(value, 3)).join(", ")}]`;
}

function formatPoles(poles: Array<{ real: number; imag: number }>): string {
  return poles
    .map((pole) => {
      if (Math.abs(pole.imag) < 1e-10) return formatNumber(pole.real, 3);
      return `${formatNumber(pole.real, 3)} ${pole.imag >= 0 ? "+" : "−"} ${formatNumber(Math.abs(pole.imag), 3)}i`;
    })
    .join(", ");
}

export function SafeLearningPanel({ diagram, simulation }: SafeLearningPanelProps) {
  const diagramKey = useMemo(() => diagram ? JSON.stringify(diagram) : "", [diagram]);
  const [analyzedSystem, setAnalyzedSystem] = useState<SystemAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const system = simulation?.system_analysis ?? analyzedSystem;
  const [inputBlockId, setInputBlockId] = useState("");
  const [outputLabel, setOutputLabel] = useState("");
  const [options, setOptions] = useState<LearningOptions>(DEFAULT_OPTIONS);
  const [learningResult, setLearningResult] = useState<SafeLearningResponse | null>(null);
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  useEffect(() => {
    let cancelled = false;
    if (!diagram || !diagramKey) {
      setAnalyzedSystem(null);
      setIsAnalyzing(false);
      return () => { cancelled = true; };
    }
    if (simulation?.system_analysis) {
      setAnalyzedSystem(simulation.system_analysis);
      setAnalysisError("");
      setIsAnalyzing(false);
      return () => { cancelled = true; };
    }
    setIsAnalyzing(true);
    setAnalysisError("");
    void analyzeDiagram(diagram)
      .then((analysis) => {
        if (!cancelled) setAnalyzedSystem(analysis);
      })
      .catch((analysisFailure) => {
        if (!cancelled) {
          setAnalyzedSystem(null);
          setAnalysisError(analysisFailure instanceof Error ? analysisFailure.message : "Не удалось собрать модель.");
        }
      })
      .finally(() => {
        if (!cancelled) setIsAnalyzing(false);
      });
    return () => { cancelled = true; };
  }, [diagramKey, simulation?.system_analysis]);

  useEffect(() => {
    if (!system) return;
    setInputBlockId((current) => system.input_blocks.includes(current) ? current : system.input_blocks[0] ?? "");
    setOutputLabel((current) => system.output_labels.includes(current) ? current : system.output_labels[0] ?? "");
    setLearningResult(null);
    setError("");
  }, [system]);

  const canRun = Boolean(
    diagram &&
    system &&
    system.state_dimension > 0 &&
    system.input_dimension > 0 &&
    system.output_dimension > 0 &&
    inputBlockId &&
    outputLabel
  );

  const interventionSamples = useMemo(() => {
    if (!learningResult) return [];
    return learningResult.trace.time.filter((_, index) => learningResult.trace.supervisor_active[index] > 0);
  }, [learningResult]);

  function updateNumber<K extends keyof LearningOptions>(key: K, value: string) {
    setOptions((current) => ({ ...current, [key]: Number(value) }));
  }

  async function runLearning() {
    if (!diagram || !canRun || isRunning) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsRunning(true);
    setError("");
    setLearningResult(null);
    const timeout = window.setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await runSafeControllerLearning({
        diagram,
        input_block_id: inputBlockId,
        output_label: outputLabel,
        horizon: options.horizon,
        dt: options.dt,
        training_trajectories: options.trainingTrajectories,
        validation_trajectories: options.validationTrajectories,
        initial_state_scale: options.initialStateScale,
        state_noise_std: options.stateNoiseStd,
        safety_decay: options.safetyDecay,
        input_limit: options.inputLimit,
        mpc_horizon_steps: options.mpcHorizonSteps,
        on_policy_rounds: options.onPolicyRounds,
        on_policy_trajectories: options.onPolicyTrajectories,
        seed: 42
      }, controller.signal);
      setLearningResult(response);
    } catch (runError) {
      setError(
        runError instanceof Error && runError.name === "AbortError"
          ? "Обучение остановлено по тайм-ауту. Уменьшите число траекторий или горизонт."
          : runError instanceof Error
            ? runError.message
            : "Не удалось выполнить обучение регулятора."
      );
    } finally {
      window.clearTimeout(timeout);
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setIsRunning(false);
      }
    }
  }

  if (isAnalyzing) {
    return <p>Собираем матрицы A, B, C и D текущей схемы…</p>;
  }

  if (analysisError) {
    return <div className="safe-learning-error" role="alert">{analysisError}</div>;
  }

  if (!system) {
    return <p>Соберите корректную схему с динамическим объектом, StepInput и Scope.</p>;
  }

  if (system.state_dimension === 0) {
    return <p>Статическую схему обучать нельзя. Добавьте динамический объект хотя бы первого порядка.</p>;
  }

  return (
    <div className="safe-learning-view">
      <section className="safe-learning-intro">
        <div>
          <span>Метод</span>
          <h3>Ограниченный MPC → нелинейный ученик → Lyapunov-supervisor</h3>
        </div>
        <p>
          Матрицы текущей схемы собираются автоматически — предварительно запускать обычное моделирование не нужно.
          Конечногоризонтный MPC размечает пары <code>x → u</code> с учётом ограничения привода.
          Нелинейная политика сначала учится по демонстрациям, затем запрашивает учителя на
          состояниях собственных траекторий. Supervisor проверяет фактически приложенное действие
          один раз за такт в sampled-data модели по функции <code>V(x)=xᵀPx</code>, а резервный LQR имеет формальную гарантию только
          внутри вычисленной области <code>Ωρ</code>.
        </p>
      </section>

      <section className="safe-learning-controls">
        <label className="tool-input">
          <span>Канал управления</span>
          <select value={inputBlockId} onChange={(event) => setInputBlockId(event.target.value)} disabled={isRunning}>
            {system.input_blocks.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="tool-input">
          <span>Наблюдаемый выход</span>
          <select value={outputLabel} onChange={(event) => setOutputLabel(event.target.value)} disabled={isRunning}>
            {system.output_labels.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="tool-input">
          <span>Горизонт, с</span>
          <input type="number" min={0.2} max={60} step={0.5} value={options.horizon} onChange={(event) => updateNumber("horizon", event.target.value)} disabled={isRunning} />
        </label>
        <label className="tool-input">
          <span>Шаг, с</span>
          <input type="number" min={0.001} max={0.2} step={0.005} value={options.dt} onChange={(event) => updateNumber("dt", event.target.value)} disabled={isRunning} />
        </label>
        <label className="tool-input">
          <span>Учебных траекторий</span>
          <input type="number" min={2} max={80} value={options.trainingTrajectories} onChange={(event) => updateNumber("trainingTrajectories", event.target.value)} disabled={isRunning} />
        </label>
        <label className="tool-input">
          <span>Проверочных траекторий</span>
          <input type="number" min={4} max={200} value={options.validationTrajectories} onChange={(event) => updateNumber("validationTrajectories", event.target.value)} disabled={isRunning} />
        </label>
        <label className="tool-input">
          <span>Масштаб x(0)</span>
          <input type="number" min={0.01} max={100} step={0.1} value={options.initialStateScale} onChange={(event) => updateNumber("initialStateScale", event.target.value)} disabled={isRunning} />
        </label>
        <label className="tool-input">
          <span>Шум измерения x</span>
          <input type="number" min={0} max={2} step={0.01} value={options.stateNoiseStd} onChange={(event) => updateNumber("stateNoiseStd", event.target.value)} disabled={isRunning} />
        </label>
        <label className="tool-input">
          <span>Порог α кандидата</span>
          <input type="number" min={0.001} max={1} step={0.01} value={options.safetyDecay} onChange={(event) => updateNumber("safetyDecay", event.target.value)} disabled={isRunning} />
        </label>
        <label className="tool-input">
          <span>Ограничение |u|max</span>
          <input type="number" min={0.01} max={10000} step={0.1} value={options.inputLimit} onChange={(event) => updateNumber("inputLimit", event.target.value)} disabled={isRunning} />
        </label>
        <label className="tool-input">
          <span>Горизонт MPC, шагов</span>
          <input type="number" min={2} max={80} step={1} value={options.mpcHorizonSteps} onChange={(event) => updateNumber("mpcHorizonSteps", event.target.value)} disabled={isRunning} />
        </label>
        <label className="tool-input">
          <span>On-policy раундов</span>
          <input type="number" min={0} max={5} step={1} value={options.onPolicyRounds} onChange={(event) => updateNumber("onPolicyRounds", event.target.value)} disabled={isRunning} />
        </label>
        <label className="tool-input">
          <span>Траекторий на раунд</span>
          <input type="number" min={1} max={20} step={1} value={options.onPolicyTrajectories} onChange={(event) => updateNumber("onPolicyTrajectories", event.target.value)} disabled={isRunning} />
        </label>
        <button type="button" className="btn btn-primary safe-learning-run" disabled={!canRun || isRunning} onClick={() => void runLearning()}>
          {isRunning ? "MPC, обучение и проверка…" : "Запустить эксперимент"}
        </button>
      </section>

      <p className="safe-learning-assumption">
        Режим синтезирует внешний регулятор для всей собранной модели, поэтому его корректнее
        запускать на разомкнутом объекте. Используется полное состояние; для реального объекта
        потребуется наблюдатель. MPC учитывает только ограничение входа; здесь проверяется устойчивость
        номинальной модели, а не безопасность относительно ограничений состояния — для неё нужен CBF-фильтр.
      </p>

      {error && <div className="safe-learning-error" role="alert">{error}</div>}

      {learningResult && (
        <>
          <section className="safe-learning-summary">
            <article>
              <span>Размер обучающей выборки</span>
              <strong>{learningResult.dataset.training_samples}</strong>
              <small>RMSE train: {formatNumber(learningResult.dataset.train_imitation_rmse)}</small>
            </article>
            <article>
              <span>RMSE на новых состояниях</span>
              <strong>{formatNumber(learningResult.dataset.test_imitation_rmse)}</strong>
              <small>Отложенная проверочная выборка</small>
            </article>
            <article>
              <span>On-policy примеров</span>
              <strong>{learningResult.dataset.on_policy_samples}</strong>
              <small>
                RMSE {learningResult.dataset.on_policy_rmse_before === null ? "н/д" : formatNumber(learningResult.dataset.on_policy_rmse_before)}
                {" → "}
                {learningResult.dataset.on_policy_rmse_after === null ? "н/д" : formatNumber(learningResult.dataset.on_policy_rmse_after)}
              </small>
            </article>
            <article>
              <span>Точек внутри Ωρ</span>
              <strong>{formatNumber(learningResult.safety.certified_decision_percent, 1)}%</strong>
              <small>Начальных состояний: {formatNumber(learningResult.safety.validation_initial_states_inside_percent, 1)}%</small>
            </article>
            <article>
              <span>Принято supervisor</span>
              <strong>{formatNumber(learningResult.safety.candidate_acceptance_percent, 1)}%</strong>
              <small>{learningResult.safety.interventions} переключений из {learningResult.safety.decisions}</small>
            </article>
          </section>

          <section className="safe-learning-plots">
            <article>
              <h3>Выход {learningResult.model.output_label}</h3>
              <Plot
                data={[
                  { x: learningResult.trace.time, y: learningResult.trace.basis_output, type: "scatter", mode: "lines", name: "Базовый LQR", line: { color: "#666666", width: 1.4 } },
                  { x: learningResult.trace.time, y: learningResult.trace.teacher_output, type: "scatter", mode: "lines", name: "Ограниченный MPC", line: { color: "#b4b4b4", width: 1.6, dash: "dot" } },
                  { x: learningResult.trace.time, y: learningResult.trace.learner_output, type: "scatter", mode: "lines", name: "Нелинейный ученик", line: { color: "#8a8a8a", width: 1.5 } },
                  { x: learningResult.trace.time, y: learningResult.trace.supervised_output, type: "scatter", mode: "lines", name: "Ученик + supervisor", line: { color: "#da5c2c", width: 2.2 } }
                ]}
                layout={{ ...plotTheme, title: "Сравнение одной проверочной траектории", yaxis: { ...plotTheme.yaxis, title: "y(t)" } }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: "100%", height: "330px" }}
                useResizeHandler
              />
            </article>
            <article>
              <h3>Норма состояния</h3>
              <Plot
                data={[
                  { x: learningResult.trace.time, y: learningResult.trace.basis_state_norm, type: "scatter", mode: "lines", name: "Базовый LQR", line: { color: "#666666", width: 1.4 } },
                  { x: learningResult.trace.time, y: learningResult.trace.teacher_state_norm, type: "scatter", mode: "lines", name: "Ограниченный MPC", line: { color: "#b4b4b4", width: 1.6, dash: "dot" } },
                  { x: learningResult.trace.time, y: learningResult.trace.learner_state_norm, type: "scatter", mode: "lines", name: "Нелинейный ученик", line: { color: "#8a8a8a", width: 1.5 } },
                  { x: learningResult.trace.time, y: learningResult.trace.supervised_state_norm, type: "scatter", mode: "lines", name: "Ученик + supervisor", line: { color: "#da5c2c", width: 2.2 } }
                ]}
                layout={{ ...plotTheme, title: `Интервенций supervisor: ${interventionSamples.length}`, yaxis: { ...plotTheme.yaxis, title: "||x(t)||" } }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: "100%", height: "330px" }}
                useResizeHandler
              />
            </article>
            <article>
              <h3>Фактически приложенное управление</h3>
              <Plot
                data={[
                  { x: learningResult.trace.time, y: learningResult.trace.basis_action, type: "scatter", mode: "lines", name: "Резервный LQR", line: { color: "#666666", width: 1.4, shape: "hv" } },
                  { x: learningResult.trace.time, y: learningResult.trace.teacher_action, type: "scatter", mode: "lines", name: "Ограниченный MPC", line: { color: "#b4b4b4", width: 1.6, dash: "dot", shape: "hv" } },
                  { x: learningResult.trace.time, y: learningResult.trace.learner_action, type: "scatter", mode: "lines", name: "Нелинейный ученик", line: { color: "#8a8a8a", width: 1.5, shape: "hv" } },
                  { x: learningResult.trace.time, y: learningResult.trace.supervised_action, type: "scatter", mode: "lines", name: "Ученик + supervisor", line: { color: "#da5c2c", width: 2.2, shape: "hv" } },
                  ...(learningResult.safety.input_limit === null ? [] : [
                    { x: learningResult.trace.time, y: learningResult.trace.time.map(() => learningResult.safety.input_limit as number), type: "scatter" as const, mode: "lines" as const, name: "+umax", line: { color: "#7e7e7e", width: 1, dash: "dash" as const } },
                    { x: learningResult.trace.time, y: learningResult.trace.time.map(() => -(learningResult.safety.input_limit as number)), type: "scatter" as const, mode: "lines" as const, name: "−umax", line: { color: "#7e7e7e", width: 1, dash: "dash" as const } }
                  ])
                ]}
                layout={{ ...plotTheme, title: `Насыщения кандидата: ${learningResult.safety.candidate_saturations}; резерва: ${learningResult.safety.backup_saturations}`, yaxis: { ...plotTheme.yaxis, title: "u(t)" } }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: "100%", height: "330px" }}
                useResizeHandler
              />
            </article>
            <article>
              <h3>Функция Ляпунова и область гарантии</h3>
              <Plot
                data={[
                  { x: learningResult.trace.time, y: learningResult.trace.lyapunov_value, type: "scatter", mode: "lines", name: "V(x)", line: { color: "#da5c2c", width: 2.2 } },
                  ...(learningResult.safety.certified_rho === null ? [] : [
                    { x: learningResult.trace.time, y: learningResult.trace.time.map(() => learningResult.safety.certified_rho as number), type: "scatter" as const, mode: "lines" as const, name: "ρ", line: { color: "#b4b4b4", width: 1.2, dash: "dash" as const } }
                  ])
                ]}
                layout={{ ...plotTheme, title: learningResult.safety.certified_rho === null ? "Глобальная ненасыщенная оценка" : "V ≤ ρ — сертифицированный режим", yaxis: { ...plotTheme.yaxis, title: "V(x)" } }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: "100%", height: "330px" }}
                useResizeHandler
              />
            </article>
          </section>

          <section className="safe-learning-table-wrap">
            <h3>Законы управления</h3>
            <table>
              <thead><tr><th>Политика</th><th>Роль</th><th>Тип / признаки</th><th>Локальная K</th><th>Полюса z</th><th>Шур-устойчива</th></tr></thead>
              <tbody>
                {learningResult.policies.map((policy) => (
                  <tr key={policy.name}>
                    <td>{policy.name}</td>
                    <td>{policy.role}</td>
                    <td><code>{policy.policy_kind}</code><br /><small>{policy.feature_count} параметров/признаков</small></td>
                    <td><code>{formatGain(policy.gain)}</code></td>
                    <td><code>{formatPoles(policy.closed_loop_poles)}</code><br /><small>{policy.pole_domain}-плоскость</small></td>
                    <td>{policy.asymptotically_stable ? "да" : "нет"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="safe-learning-certificate">
            <div>
              <span>MPC-горизонт</span>
              <strong>{learningResult.teacher.horizon_steps} × {formatNumber(learningResult.teacher.sample_time, 3)} с</strong>
              <small>{formatNumber(learningResult.teacher.prediction_horizon, 3)} с прогноза</small>
            </div>
            <div>
              <span>Ограничение учителя</span>
              <code>{learningResult.teacher.input_constraint}</code>
              <small>{learningResult.teacher.state_constraints}</small>
            </div>
            <div>
              <span>Решение box-QP</span>
              <strong>{formatNumber(learningResult.teacher.converged_percent, 1)}%</strong>
              <small>{learningResult.teacher.solver_queries} запросов; в среднем {formatNumber(learningResult.teacher.mean_iterations, 1)} итераций</small>
            </div>
            <div>
              <span>Активное ограничение</span>
              <strong>{formatNumber(learningResult.teacher.active_constraint_percent, 1)}%</strong>
              <small>макс. projected residual: {formatNumber(learningResult.teacher.max_projected_residual)}</small>
            </div>
            <div>
              <span>Терминальная стоимость</span>
              <code>{learningResult.teacher.terminal_cost}</code>
              <small>{learningResult.teacher.solver}</small>
            </div>
          </section>

          <section className="safe-learning-table-wrap">
            <h3>Проверка на {learningResult.dataset.validation_trajectories} новых начальных состояниях</h3>
            <table>
              <thead><tr><th>Режим</th><th>Средний J</th><th>Медиана J</th><th>Стабилизация</th><th>Насыщение u</th><th>Макс. ||x||</th></tr></thead>
              <tbody>
                {learningResult.evaluation.map((row) => (
                  <tr key={row.policy}>
                    <td>{row.policy}</td>
                    <td>{formatNumber(row.mean_cost)}</td>
                    <td>{formatNumber(row.median_cost)}</td>
                    <td>{formatNumber(row.stabilization_percent, 1)}%</td>
                    <td>{formatNumber(row.saturation_percent, 1)}%</td>
                    <td>{formatNumber(row.worst_state_norm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="safe-learning-certificate">
            <div>
              <span>Статус доказательства</span>
              <strong>{learningResult.safety.certificate_kind === "global_unsaturated" ? "глобальное" : "локальное"}</strong>
              <small>{learningResult.safety.certificate_domain} · dt={formatNumber(learningResult.safety.sample_time, 3)} с</small>
            </div>
            <div>
              <span>Сертифицированная область</span>
              <code>{learningResult.safety.certified_rho === null ? "Ω = ℝⁿ" : `xᵀPx ≤ ${formatNumber(learningResult.safety.certified_rho)}`}</code>
              <small>{learningResult.safety.certified_inner_radius === null ? "без ограничения u" : `внутренний радиус ||x|| ≤ ${formatNumber(learningResult.safety.certified_inner_radius)}`}</small>
            </div>
            <div>
              <span>Условие допуска кандидата</span>
              <code>{learningResult.safety.admission_condition}</code>
              <small>α = {formatNumber(learningResult.safety.requested_decay)}; резерв ≥ {formatNumber(learningResult.safety.backup_decay)}</small>
            </div>
            <div>
              <span>Режимы supervisor</span>
              <strong>{learningResult.safety.certified_decisions} / {learningResult.safety.heuristic_decisions}</strong>
              <small>сертифицированных / эвристических решений</small>
            </div>
            <div>
              <span>Интервенции</span>
              <strong>{formatNumber(learningResult.safety.intervention_percent, 2)}%</strong>
              <small>насыщений резерва внутри Ωρ: {learningResult.safety.certified_backup_saturations}</small>
            </div>
          </section>

          {learningResult.warnings.length > 0 && (
            <ul className="safe-learning-warnings">
              {learningResult.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

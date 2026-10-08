import { useEffect, useMemo, useRef, useState } from "react";
import {
  ExperimentsApiError,
  fetchExperimentsCatalog,
  runExperiment
} from "../api/experiments";
import type {
  ExperimentCatalogResponse,
  ExperimentCatalogScenario,
  ExperimentFormState,
  ExperimentRunPayload,
  ExperimentRunResponse,
  ExperimentSolver
} from "../types/experiments";

const DEFAULT_SOLVERS: ExperimentSolver[] = ["rk4", "solve_ivp"];
const PREFERRED_DEFAULT_SCENARIO = "second_order_oscillator";
const EXPERIMENT_TIMEOUT_MS = 120_000;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function dtValuesToText(values: number[]): string {
  return values.join(", ");
}

function buildDefaultFormState(scenario: ExperimentCatalogScenario): ExperimentFormState {
  return {
    scenario: scenario.slug,
    solvers: [...DEFAULT_SOLVERS],
    dt: scenario.default_dt,
    tEnd: scenario.default_t_end,
    includeAnalytic: true,
    runAccuracy: true,
    runSolverComparison: true,
    runDtSweep: true,
    dtValuesText: dtValuesToText(scenario.default_dt_values),
    runBenchmark: true,
    benchmarkRepetitions: scenario.default_benchmark_repetitions,
    benchmarkWarmup: scenario.default_benchmark_warmup,
    runParameterSweep: false,
    parameterValuesText: dtValuesToText(scenario.default_parameter_values),
    runMonteCarlo: false,
    monteCarloSamples: 30,
    uncertaintyPercent: 20
  };
}

function parseDtValues(text: string): number[] {
  return text
    .split(",")
    .map((token) => Number(token.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function getInitialScenario(catalog: ExperimentCatalogResponse): ExperimentCatalogScenario {
  return (
    catalog.scenarios.find((scenario) => scenario.slug === PREFERRED_DEFAULT_SCENARIO) ??
    catalog.scenarios[0]
  );
}

export function useExperimentsRunner() {
  const [catalog, setCatalog] = useState<ExperimentCatalogResponse | null>(null);
  const [formState, setFormState] = useState<ExperimentFormState | null>(null);
  const [result, setResult] = useState<ExperimentRunResponse | null>(null);
  const [error, setError] = useState("");
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const mountedRef = useRef(true);
  const runningRef = useRef(false);
  const activeRunControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeRunControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let isDisposed = false;

    async function loadCatalog() {
      setIsLoadingCatalog(true);
      setError("");
      try {
        const nextCatalog = await fetchExperimentsCatalog(controller.signal);
        if (isDisposed || !mountedRef.current) {
          return;
        }
        setCatalog(nextCatalog);
        setFormState(buildDefaultFormState(getInitialScenario(nextCatalog)));
      } catch (loadError) {
        if (isDisposed || !mountedRef.current || isAbortError(loadError)) {
          return;
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Не удалось загрузить каталог экспериментальных сценариев."
        );
      } finally {
        if (!isDisposed && mountedRef.current) {
          setIsLoadingCatalog(false);
        }
      }
    }

    void loadCatalog();
    return () => {
      isDisposed = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!isRunning) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((performance.now() - startedAt) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  const selectedScenario = useMemo(() => {
    if (!catalog || !formState) {
      return null;
    }
    return catalog.scenarios.find((scenario) => scenario.slug === formState.scenario) ?? null;
  }, [catalog, formState]);

  function applyScenarioDefaults(slug: string, resetAll: boolean) {
    if (!catalog || !formState) {
      return;
    }
    const scenario = catalog.scenarios.find((item) => item.slug === slug);
    if (!scenario) {
      return;
    }
    const defaults = buildDefaultFormState(scenario);
    setFormState((current) => {
      if (!current || resetAll) {
        return defaults;
      }
      return {
        ...current,
        scenario: scenario.slug,
        dt: scenario.default_dt,
        tEnd: scenario.default_t_end,
        dtValuesText: dtValuesToText(scenario.default_dt_values),
        benchmarkRepetitions: scenario.default_benchmark_repetitions,
        benchmarkWarmup: scenario.default_benchmark_warmup,
        parameterValuesText: dtValuesToText(scenario.default_parameter_values)
      };
    });
  }

  function updateField<K extends keyof ExperimentFormState>(
    field: K,
    value: ExperimentFormState[K]
  ) {
    setFormState((current) => (current ? { ...current, [field]: value } : current));
  }

  function toggleSolver(solver: ExperimentSolver) {
    setFormState((current) => {
      if (!current) {
        return current;
      }
      const nextSolvers = current.solvers.includes(solver)
        ? current.solvers.filter((item) => item !== solver)
        : [...current.solvers, solver];
      return { ...current, solvers: nextSolvers };
    });
  }

  async function runCurrentExperiment() {
    if (!formState || runningRef.current) {
      return;
    }

    if (formState.solvers.length === 0) {
      setError("Нужно выбрать хотя бы один solver.");
      return;
    }

    const parsedDtValues = parseDtValues(formState.dtValuesText);
    const parsedParameterValues = formState.parameterValuesText
      .split(",")
      .map((token) => Number(token.trim()))
      .filter((value) => Number.isFinite(value));
    if (formState.runDtSweep && parsedDtValues.length === 0) {
      setError("Для dt sweep укажите хотя бы одно положительное значение dt.");
      return;
    }
    if (formState.runParameterSweep && parsedParameterValues.length === 0) {
      setError("Для parameter sweep укажите хотя бы одно конечное значение.");
      return;
    }

    const payload: ExperimentRunPayload = {
      scenario: formState.scenario,
      solvers: formState.solvers,
      dt: formState.dt,
      t_end: formState.tEnd,
      include_analytic: formState.includeAnalytic,
      run_accuracy: formState.runAccuracy,
      run_solver_comparison: formState.runSolverComparison,
      run_dt_sweep: formState.runDtSweep,
      dt_values: parsedDtValues,
      run_benchmark: formState.runBenchmark,
      benchmark_repetitions: formState.benchmarkRepetitions,
      benchmark_warmup: formState.benchmarkWarmup,
      run_parameter_sweep: formState.runParameterSweep,
      parameter_block_id: selectedScenario?.parameter_block_id,
      parameter_name: selectedScenario?.parameter_name,
      parameter_values: parsedParameterValues,
      run_monte_carlo: formState.runMonteCarlo,
      monte_carlo_samples: formState.monteCarloSamples,
      uncertainty_percent: formState.uncertaintyPercent,
      random_seed: 42
    };

    const controller = new AbortController();
    activeRunControllerRef.current = controller;
    runningRef.current = true;
    setIsRunning(true);
    setError("");
    let didTimeOut = false;
    const timeout = window.setTimeout(() => {
      didTimeOut = true;
      controller.abort();
    }, EXPERIMENT_TIMEOUT_MS);
    try {
      const nextResult = await runExperiment(payload, controller.signal);
      if (mountedRef.current) {
        setResult(nextResult);
      }
    } catch (runError) {
      if (!mountedRef.current) {
        return;
      }
      setResult(null);
      setError(
        isAbortError(runError)
          ? didTimeOut
            ? "Эксперимент выполнялся дольше двух минут и был остановлен. Уменьшите число повторов или отключите тяжёлые режимы."
            : "Эксперимент был остановлен."
          : runError instanceof ExperimentsApiError
          ? `Backend вернул ошибку: ${runError.message}`
          : runError instanceof Error
            ? runError.message
            : "Не удалось выполнить эксперимент."
      );
    } finally {
      window.clearTimeout(timeout);
      if (activeRunControllerRef.current === controller) {
        activeRunControllerRef.current = null;
        runningRef.current = false;
        if (mountedRef.current) {
          setIsRunning(false);
        }
      }
    }
  }

  function resetToDefaults() {
    if (!selectedScenario) {
      return;
    }
    applyScenarioDefaults(selectedScenario.slug, true);
  }

  return {
    catalog,
    formState,
    result,
    error,
    isLoadingCatalog,
    isRunning,
    elapsedSeconds,
    selectedScenario,
    updateField,
    toggleSolver,
    runCurrentExperiment,
    resetToDefaults,
    selectScenario: (slug: string) => applyScenarioDefaults(slug, false)
  };
}

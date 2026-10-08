export type ExperimentSolver = "rk4" | "solve_ivp";

export interface ExperimentCatalogScenario {
  slug: string;
  title: string;
  description: string;
  default_dt: number;
  default_t_end: number;
  default_dt_values: number[];
  default_benchmark_repetitions: number;
  default_benchmark_warmup: number;
  parameter_block_id: string;
  parameter_name: string;
  parameter_nominal: number;
  default_parameter_values: number[];
}

export interface ExperimentCatalogResponse {
  scenarios: ExperimentCatalogScenario[];
  solvers: ExperimentSolver[];
}

export interface ExperimentRunPayload {
  scenario: string;
  solvers: ExperimentSolver[];
  dt: number;
  t_end: number;
  include_analytic: boolean;
  run_accuracy: boolean;
  run_solver_comparison: boolean;
  run_dt_sweep: boolean;
  dt_values: number[];
  run_benchmark: boolean;
  benchmark_repetitions: number;
  benchmark_warmup: number;
  run_parameter_sweep: boolean;
  parameter_block_id?: string;
  parameter_name?: string;
  parameter_values: number[];
  run_monte_carlo: boolean;
  monte_carlo_samples: number;
  uncertainty_percent: number;
  random_seed: number;
}

export interface ExperimentScenarioMetadata {
  slug: string;
  title: string;
  description: string;
  requested_dt: number;
  requested_t_end: number;
  selected_solvers: ExperimentSolver[];
}

export interface ExperimentEnvironmentSummary {
  generated_at_utc: string;
  python_version: string;
  platform: string;
}

export interface ExperimentTimeseries {
  time: number[];
  analytic: number[] | null;
  rk4: number[] | null;
  solve_ivp: number[] | null;
}

export interface ExperimentAccuracyRow {
  solver: ExperimentSolver;
  dt: number;
  max_abs_error: number;
  rmse: number;
  final_value_error: number;
}

export interface ExperimentSolverComparisonRow {
  max_abs_diff: number;
  rmse_diff: number;
  final_value_diff: number;
}

export interface ExperimentDtSweepRow {
  solver: ExperimentSolver;
  dt: number;
  max_abs_error: number;
  rmse: number;
  final_value_error: number;
}

export interface ExperimentBenchmarkSummaryRow {
  solver: ExperimentSolver;
  mean_ms: number;
  median_ms: number;
  std_ms: number;
  min_ms: number;
  max_ms: number;
  repetitions: number;
}

export interface ExperimentBenchmarkSampleRow {
  solver: ExperimentSolver;
  iteration: number;
  duration_ms: number;
}

export interface ExperimentParameterSweepRow {
  parameter_value: number;
  stability: string;
  spectral_abscissa: number | null;
  final_value: number | null;
  overshoot_percent: number | null;
  settling_time: number | null;
  integral_absolute_error: number | null;
}

export interface ExperimentMonteCarloSampleRow extends ExperimentParameterSweepRow {
  sample: number;
}

export interface ExperimentRobustSummary {
  parameter_block_id: string;
  parameter_name: string;
  nominal_value: number;
  solver: ExperimentSolver;
  sample_count: number;
  stable_samples: number;
  robust_stability_percent: number;
  worst_spectral_abscissa: number | null;
  final_value_min: number | null;
  final_value_max: number | null;
}

export interface ExperimentRunResponse {
  scenario: ExperimentScenarioMetadata;
  environment: ExperimentEnvironmentSummary;
  timeseries: ExperimentTimeseries;
  accuracy_rows: ExperimentAccuracyRow[];
  solver_comparison_rows: ExperimentSolverComparisonRow[];
  dt_sweep_rows: ExperimentDtSweepRow[];
  benchmark_summary_rows: ExperimentBenchmarkSummaryRow[];
  benchmark_samples: ExperimentBenchmarkSampleRow[];
  parameter_sweep_rows: ExperimentParameterSweepRow[];
  monte_carlo_rows: ExperimentMonteCarloSampleRow[];
  robust_summary: ExperimentRobustSummary | null;
  warnings: string[];
  interpretation_notes: string[];
}

export interface ExperimentFormState {
  scenario: string;
  solvers: ExperimentSolver[];
  dt: number;
  tEnd: number;
  includeAnalytic: boolean;
  runAccuracy: boolean;
  runSolverComparison: boolean;
  runDtSweep: boolean;
  dtValuesText: string;
  runBenchmark: boolean;
  benchmarkRepetitions: number;
  benchmarkWarmup: number;
  runParameterSweep: boolean;
  parameterValuesText: string;
  runMonteCarlo: boolean;
  monteCarloSamples: number;
  uncertaintyPercent: number;
}

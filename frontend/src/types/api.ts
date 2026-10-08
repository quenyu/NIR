import type { Diagram } from "./diagram";

export interface ValidateResponse {
  valid: boolean;
  errors: string[];
}

export interface SimulationRequestPayload {
  diagram: Diagram;
  t_start: number;
  t_end: number;
  dt?: number;
  t_eval?: number[];
  solver: "rk4" | "solve_ivp";
}

export interface SimulationStateSource {
  block_id?: string;
  local_block_id?: string;
  block_name?: string;
  block_type?: string;
  source_block_id?: string;
  subsystem_id?: string;
  subsystem_name?: string;
  subsystem_path?: string | string[];
  source_subsystem_path?: string | string[];
  local_state?: string;
  local_index?: number;
  local_state_index?: number;
  description?: string;
  [key: string]: unknown;
}

export interface SimulationStateMappingEntry extends SimulationStateSource {
  index?: number;
  global_index?: number;
  state_index?: number;
  state?: string;
  state_label?: string;
  label?: string;
  source?: string | SimulationStateSource;
  provenance?: string | SimulationStateSource;
}

export type SimulationStateMapping =
  | SimulationStateMappingEntry[]
  | Record<string, string | SimulationStateMappingEntry>;

export interface SimulationModelProvenance {
  index_base?: number;
  state_mapping?: SimulationStateMapping;
  states?: SimulationStateMapping;
  matrix_dimensions?: Partial<
    Record<
      "A" | "B" | "C" | "D",
      {
        shape: [number, number];
        explanation: string;
      }
    >
  >;
  [key: string]: unknown;
}

export interface SimulationMetadata extends Record<string, unknown> {
  state_mapping?: SimulationStateMapping;
  provenance?: SimulationModelProvenance | SimulationStateMapping;
}

export interface SimulationResponse {
  success: boolean;
  time: number[];
  outputs: Record<string, number[]>;
  metadata: SimulationMetadata;
  stability_analysis: {
    overall_status?: string;
    transfer_functions?: Array<{
      block_id: string;
      status: string;
      poles: Array<{ real: number; imag: number }>;
    }>;
  };
  system_analysis?: {
    model_type: string;
    state_dimension: number;
    input_dimension: number;
    output_dimension: number;
    state_labels: string[];
    input_blocks: string[];
    input_convention?: string;
    output_labels: string[];
    matrices: {
      A: number[][];
      B: number[][];
      C: number[][];
      D: number[][];
    };
    poles: Array<{ real: number; imag: number }>;
    modes: Array<{ natural_frequency: number; damping_ratio: number | null }>;
    characteristic_polynomial: number[];
    spectral_abscissa: number | null;
    stability_degree: number | null;
    stability: string;
    controllability: { rank: number; applicable?: boolean; full_rank: boolean | null };
    observability: { rank: number; applicable?: boolean; full_rank: boolean | null };
    verification?: {
      status: "verified" | "failed";
      passed: boolean;
      method: string;
      description: string;
      dimensions_valid: boolean;
      finite: boolean;
      expected_shapes: Record<"A" | "B" | "C" | "D", [number, number]>;
      probe_count: number;
      tolerance: number;
      zero_state_residual: number | null;
      zero_output_residual: number | null;
      max_state_residual: number | null;
      max_output_residual: number | null;
    };
  };
  frequency_analysis?: {
    available: boolean;
    reason?: string;
    input_block?: string;
    output_label?: string;
    channel_kind?: string;
    channel_warning?: string | null;
    frequency_rad_s?: number[];
    magnitude?: number[];
    magnitude_db?: number[];
    phase_deg?: number[];
    nyquist_real?: number[];
    nyquist_imag?: number[];
    gain_crossovers_rad_s?: number[];
    phase_crossovers_rad_s?: number[];
    phase_margins_deg?: number[];
    gain_margins_db?: number[];
    critical_phase_margin_deg?: number | null;
    critical_gain_margin_db?: number | null;
    gain_crossover_status?: string;
    frequency_range_rad_s?: [number, number];
    interpretation?: string;
  };
  quality_metrics: Record<
    string,
    {
      final_value: number | null;
      target_value: number | null;
      target_source: string | null;
      min_value: number | null;
      max_value: number | null;
      overshoot_percent: number | null;
      settling_time: number | null;
      rise_time: number | null;
      steady_state_error: number | null;
      integral_absolute_error: number | null;
      integral_squared_error: number | null;
      settling_band_percent: number | null;
      reference: number | string | null;
    }
  >;
  warnings: string[];
  validation_errors: string[];
}

export type SystemAnalysis = NonNullable<SimulationResponse["system_analysis"]>;

export interface AnalyzeResponse {
  success: boolean;
  analysis: SystemAnalysis;
  validation_errors: string[];
}

export interface PIDTuneResponse {
  success: boolean;
  controller_block_id: string;
  initial_parameters: Record<string, number>;
  tuned_parameters: Record<string, number>;
  initial_score: number | null;
  tuned_score: number | null;
  improvement_percent: number | null;
  metrics: Record<string, number | null>;
  evaluations: number;
  algorithm: string;
  warnings: string[];
}

export interface SafeLearningRequestPayload {
  diagram: Diagram;
  input_block_id?: string;
  output_label?: string;
  horizon: number;
  dt: number;
  training_trajectories: number;
  validation_trajectories: number;
  initial_state_scale: number;
  state_noise_std: number;
  ridge?: number;
  control_weight?: number;
  basis_control_ratio?: number;
  safety_decay: number;
  input_limit?: number | null;
  mpc_horizon_steps: number;
  mpc_iterations?: number;
  mpc_tolerance?: number;
  on_policy_rounds: number;
  on_policy_trajectories: number;
  seed?: number;
}

export interface LearnedPolicySummary {
  name: string;
  role: string;
  policy_kind: string;
  feature_count: number;
  gain: number[][];
  closed_loop_poles: Array<{ real: number; imag: number }>;
  pole_domain: string;
  asymptotically_stable: boolean;
}

export interface LearningEvaluationRow {
  policy: string;
  mean_cost: number;
  median_cost: number;
  stabilization_percent: number;
  worst_state_norm: number;
  saturation_percent: number;
}

export interface SafeLearningTrace {
  time: number[];
  basis_output: number[];
  teacher_output: number[];
  learner_output: number[];
  supervised_output: number[];
  basis_action: number[];
  teacher_action: number[];
  learner_action: number[];
  supervised_action: number[];
  basis_state_norm: number[];
  teacher_state_norm: number[];
  learner_state_norm: number[];
  supervised_state_norm: number[];
  lyapunov_value: number[];
  supervisor_active: number[];
  certificate_active: number[];
}

export interface SafeLearningResponse {
  success: boolean;
  model: {
    state_dimension: number;
    input_block_id: string;
    output_label: string;
    controllability_rank: number;
    full_state_feedback: boolean;
    A: number[][];
    B: number[][];
    C: number[][];
    D: number[][];
    Ad?: number[][];
    Bd?: number[][];
  };
  dataset: {
    training_trajectories: number;
    initial_teacher_samples: number;
    on_policy_rounds: number;
    on_policy_trajectories_per_round: number;
    on_policy_round_samples: number[];
    on_policy_samples: number;
    training_samples: number;
    validation_trajectories: number;
    state_noise_std: number;
    ridge: number;
    feature_count: number;
    train_imitation_rmse: number;
    test_imitation_rmse: number;
    on_policy_rmse_before: number | null;
    on_policy_rmse_after: number | null;
  };
  teacher: {
    kind: "finite_horizon_linear_mpc";
    solver: string;
    horizon_steps: number;
    sample_time: number;
    prediction_horizon: number;
    decision_variables: number;
    input_constraint: string;
    state_constraints: string;
    terminal_cost: string;
    iterations_limit: number;
    tolerance: number;
    solver_queries: number;
    mean_iterations: number;
    max_iterations_used: number;
    max_projected_residual: number;
    unconverged_queries: number;
    converged_percent: number;
    active_constraint_percent: number;
  };
  policies: LearnedPolicySummary[];
  evaluation: LearningEvaluationRow[];
  safety: {
    certificate_kind: "global_unsaturated" | "local_invariant_ellipsoid";
    certificate_domain: string;
    sample_time: number;
    lyapunov_function: string;
    lyapunov_matrix: number[][];
    admission_condition: string;
    requested_decay: number;
    backup_decay: number;
    input_limit: number | null;
    certified_rho: number | null;
    certified_inner_radius: number | null;
    validation_initial_states_inside_percent: number;
    certified_decisions: number;
    heuristic_decisions: number;
    certified_decision_percent: number;
    interventions: number;
    decisions: number;
    intervention_percent: number;
    candidate_acceptance_percent: number;
    candidate_saturations: number;
    backup_saturations: number;
    certified_backup_saturations: number;
  };
  trace: SafeLearningTrace;
  warnings: string[];
}

export interface ObserverExperimentRequestPayload {
  diagram: Diagram;
  input_block_id?: string;
  output_label?: string;
  horizon: number;
  dt: number;
  input_amplitude: number;
  step_time: number;
  initial_state_scale: number;
  observer_speed_factor: number;
  process_noise_std: number;
  measurement_noise_std: number;
  seed?: number;
}

export interface ObserverSummary {
  method: "luenberger" | "kalman";
  name: string;
  gain: number[][];
  error_dynamics_poles: Array<{ real: number; imag: number }>;
  spectral_radius: number;
  asymptotically_stable: boolean;
  design: string;
  covariance: number[][] | null;
}

export interface ObserverMetrics {
  method: "luenberger" | "kalman";
  state_rmse: number;
  steady_state_rmse: number;
  rmse_by_state: number[];
  mean_error_norm: number;
  max_error_norm: number;
  final_error_norm: number;
  innovation_rms: number;
  improvement_over_zero_estimate_percent: number;
  three_sigma_coverage_percent: number | null;
}

export interface ObserverExperimentResponse {
  success: boolean;
  model: {
    state_dimension: number;
    input_dimension: number;
    output_dimension: number;
    input_block_id: string;
    output_label: string;
    state_labels: string[];
    observability_rank: number;
    fully_observable: boolean;
    A: number[][];
    B: number[][];
    C_measurement: number[][];
    D_measurement: number[][];
    Ad: number[][];
    Bd: number[][];
  };
  settings: {
    sample_time: number;
    horizon: number;
    input_amplitude: number;
    step_time: number;
    process_noise_std_per_sample: number;
    measurement_noise_std: number;
    seed: number;
    luenberger_desired_poles: number[];
  };
  observers: ObserverSummary[];
  metrics: ObserverMetrics[];
  trace: {
    time: number[];
    state_labels: string[];
    input: number[];
    true_output: number[];
    measured_output: number[];
    true_states: number[][];
    luenberger_states: number[][];
    kalman_states: number[][];
    luenberger_error_norm: number[];
    kalman_error_norm: number[];
    luenberger_innovation: number[];
    kalman_innovation: number[];
    kalman_three_sigma: number[];
  };
  warnings: string[];
}

export interface OutputFeedbackRequestPayload {
  diagram: Diagram;
  input_block_id?: string;
  output_label?: string;
  horizon: number;
  dt: number;
  initial_state_scale: number;
  observer_speed_factor: number;
  process_noise_std: number;
  measurement_noise_std: number;
  state_weight: number;
  control_weight: number;
  control_limit: number;
  reference: number;
  seed?: number;
}

export interface OutputFeedbackDesign {
  method: "full_state_lqr" | "luenberger_lqr" | "lqg";
  name: string;
  feedback_gain: number[][];
  controller_poles: Array<{ real: number; imag: number }>;
  observer_poles: Array<{ real: number; imag: number }>;
  augmented_poles: Array<{ real: number; imag: number }>;
  spectral_radius: number;
  asymptotically_stable: boolean;
  separation_matches: boolean | null;
  interpretation: string;
}

export interface OutputFeedbackMetrics {
  method: "full_state_lqr" | "luenberger_lqr" | "lqg";
  state_rms: number;
  final_state_norm: number;
  peak_state_norm: number;
  output_rms: number;
  control_rms: number;
  peak_control: number;
  saturation_percent: number;
  quadratic_cost_per_step: number;
  tracking_rmse: number;
  final_output: number;
  steady_state_error: number;
  estimation_rmse: number | null;
  final_estimation_error_norm: number | null;
}

export interface OutputFeedbackResponse {
  success: boolean;
  model: {
    state_dimension: number;
    input_dimension: number;
    output_dimension: number;
    input_block_id: string;
    output_label: string;
    state_labels: string[];
    controllability_rank: number;
    observability_rank: number;
    fully_controllable: boolean;
    fully_observable: boolean;
    Ad: number[][];
    Bd_control: number[][];
    C_measurement: number[][];
    D_measurement_control: number;
    prefilter_gain: number;
    equilibrium_state: number[];
    equilibrium_control: number;
  };
  settings: {
    sample_time: number;
    horizon: number;
    state_weight: number;
    control_weight: number;
    control_limit: number;
    reference: number;
    process_noise_std_per_sample: number;
    measurement_noise_std: number;
    initial_state_scale: number;
    seed: number;
    luenberger_desired_poles: number[];
    lqr_riccati_matrix: number[][];
    kalman_covariance: number[][];
  };
  designs: OutputFeedbackDesign[];
  metrics: OutputFeedbackMetrics[];
  trace: {
    time: number[];
    state_labels: string[];
    full_state_states: number[][];
    luenberger_states: number[][];
    kalman_states: number[][];
    luenberger_estimates: number[][];
    kalman_estimates: number[][];
    full_state_norm: number[];
    luenberger_state_norm: number[];
    kalman_state_norm: number[];
    luenberger_estimation_error_norm: number[];
    kalman_estimation_error_norm: number[];
    full_state_output: number[];
    luenberger_output: number[];
    kalman_output: number[];
    full_state_control: number[];
    luenberger_control: number[];
    kalman_control: number[];
  };
  warnings: string[];
}

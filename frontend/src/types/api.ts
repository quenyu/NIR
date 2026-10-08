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

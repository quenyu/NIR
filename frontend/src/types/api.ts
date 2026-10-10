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

export interface StructuralProperty {
  applicable: boolean;
  rank: number;
  full_rank: boolean | null;
  margin: number | null;
  weak: boolean;
  method: string;
}

export interface FrequencyChannel {
  input_block: string;
  output_label: string;
  magnitude_db: Array<number | null>;
  phase_deg: Array<number | null>;
  real: Array<number | null>;
  imag: Array<number | null>;
}

export interface SimulationResponse {
  success: boolean;
  time: number[];
  outputs: Record<string, number[]>;
  metadata: SimulationMetadata;
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
    stability_reason?: string;
    controllability: StructuralProperty;
    observability: StructuralProperty;
    algebraic_loops?: Array<{ blocks: string[]; condition_number: number }>;
  };
  frequency_analysis?: {
    available: boolean;
    reason?: string;
    frequency_rad_s?: number[];
    frequency_range_rad_s?: [number, number];
    channels?: FrequencyChannel[];
    truncated?: boolean;
    interpretation?: string;
  };
  quality_metrics: Record<
    string,
    {
      step_time?: number;
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
      reason?: string | null;
    }
  >;
  warnings: string[];
  validation_errors: string[];
}

export type SystemAnalysis = NonNullable<SimulationResponse["system_analysis"]>;

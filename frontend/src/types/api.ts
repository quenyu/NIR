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

export interface SimulationResponse {
  success: boolean;
  time: number[];
  outputs: Record<string, number[]>;
  metadata: Record<string, unknown>;
  stability_analysis: {
    overall_status?: string;
    transfer_functions?: Array<{
      block_id: string;
      status: string;
      poles: Array<{ real: number; imag: number }>;
    }>;
  };
  quality_metrics: Record<
    string,
    {
      final_value: number | null;
      max_value: number | null;
      overshoot_percent: number | null;
      settling_time: number | null;
      rise_time: number | null;
      steady_state_error: number | null;
      integral_absolute_error: number | null;
      integral_squared_error: number | null;
      settling_band_percent: number | null;
      reference: string | null;
    }
  >;
  warnings: string[];
  validation_errors: string[];
}

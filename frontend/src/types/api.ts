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
  validation_errors: string[];
}


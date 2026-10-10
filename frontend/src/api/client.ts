import type { Diagram } from "../types/diagram";
import type { SimulationRequestPayload, SimulationResponse, ValidateResponse } from "../types/api";
import type { ProjectSimulationSettings } from "../features/diagramPersistence";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

/** Error of any API call: the server's {code, message, errors} or a transport failure. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details: string[] = [],
    public readonly payload: Record<string, unknown> = {},
  ) {
    super(message);
  }

  /** Messages worth showing to the user, most specific first. */
  get messages(): string[] {
    return this.details.length > 0 ? this.details : [this.message];
  }
}

/** One line for places that show a single message. */
export function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.messages.join(" ");
  return error instanceof Error ? error.message : fallback;
}

function describeItem(item: unknown): string {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    const { path, message, msg, loc } = item as Record<string, unknown>;
    const text = typeof message === "string" ? message : typeof msg === "string" ? msg : JSON.stringify(item);
    const where = typeof path === "string" ? path : Array.isArray(loc) ? loc.slice(1).join(".") : "";
    return where ? `${where}: ${text}` : text;
  }
  return String(item);
}

async function toApiError(response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => "");
  let body: Record<string, unknown> | null = null;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  const fallback = `Сервер ответил ошибкой HTTP ${response.status}${response.statusText ? ` (${response.statusText})` : ""}.`;
  if (!body) {
    return new ApiError(fallback, response.status, "http_error");
  }
  // FastAPI's own {"detail": ...} still appears for routing errors such as 404/405.
  const rawItems = Array.isArray(body.errors) ? body.errors : Array.isArray(body.detail) ? body.detail : [];
  const message = typeof body.message === "string"
    ? body.message
    : typeof body.detail === "string" ? body.detail : fallback;
  const code = typeof body.code === "string" ? body.code : "http_error";
  return new ApiError(message, response.status, code, rawItems.map(describeItem), body);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: init.body ? { "Content-Type": "application/json", ...init.headers } : init.headers,
    });
  } catch (error) {
    if (init.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new ApiError("Запрос отменён.", 0, "aborted");
    }
    throw new ApiError(
      `Сервер моделирования недоступен (${API_BASE_URL}). Запустите backend и повторите.`,
      0,
      "server_unreachable",
    );
  }
  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError("Сервер вернул ответ не в формате JSON.", response.status, "invalid_response");
  }
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

/** Liveness of the modelling server. */
export function checkHealth(signal?: AbortSignal): Promise<{ status: string }> {
  return request("/health", { signal });
}

export function validateDiagram(diagram: Diagram): Promise<ValidateResponse> {
  return request("/validate", post({ diagram }));
}

export function simulateDiagram(payload: SimulationRequestPayload, signal?: AbortSignal): Promise<SimulationResponse> {
  return request("/simulate", { ...post(payload), signal });
}

export interface SweepPoint {
  value: number;
  poles: Array<{ real: number; imag: number }> | null;
  stability: string | null;
  error: string | null;
}

export interface SweepResponse {
  block_id: string;
  parameter: string;
  points: SweepPoint[];
}

/** Poles of the assembled model for each value of one numeric block parameter. */
export function sweepParameter(
  diagram: Diagram,
  blockId: string,
  parameter: string,
  values: number[],
  signal?: AbortSignal,
): Promise<SweepResponse> {
  return request("/analyze/sweep", { ...post({ diagram, block_id: blockId, parameter, values }), signal });
}

export interface LoopCut {
  from_block: string;
  from_port: string;
  to_block: string;
  to_port: string;
}

export interface LoopCrossing {
  frequency: number;
  value: number;
}

export interface LoopResponse {
  candidates: LoopCut[];
  cut: LoopCut | null;
  frequency: number[];
  magnitude_db: number[];
  phase_deg: number[];
  nyquist_real: number[];
  nyquist_imag: number[];
  gain_margin: number | null;
  gain_margin_db: number | null;
  phase_crossover: number | null;
  phase_margin: number | null;
  gain_crossover: number | null;
  gain_crossings: LoopCrossing[];
  phase_crossings: LoopCrossing[];
  open_loop_unstable_poles: number | null;
  encirclements: number | null;
  closed_loop_unstable_poles: number | null;
  nyquist_stable: boolean | null;
  poles_agree: boolean | null;
  hurwitz: number[];
  hurwitz_stable: boolean | null;
  notes: string[];
}

/** Open-loop frequency analysis with the loop broken at one connection (no cut: the candidates). */
export function analyzeLoop(diagram: Diagram, cut: LoopCut | null, signal?: AbortSignal): Promise<LoopResponse> {
  return request("/analyze/loop", { ...post({ diagram, cut }), signal });
}

export interface ServerProjectPayload {
  diagram: Diagram;
  layout: {
    positions: Record<string, { x: number; y: number }>;
    viewport?: { x: number; y: number; zoom: number };
  };
  simulation: ProjectSimulationSettings;
}

export interface ServerProjectSummary {
  id: string;
  title: string;
  version: number;
  block_count: number;
  created_at: string;
  updated_at: string;
}

export interface ServerProjectRecord extends ServerProjectSummary {
  payload: ServerProjectPayload;
}

const projectPath = (projectId: string) => `/projects/${encodeURIComponent(projectId)}`;

export async function listServerProjects(): Promise<ServerProjectSummary[]> {
  return (await request<{ projects: ServerProjectSummary[] }>("/projects")).projects;
}

export function getServerProject(projectId: string): Promise<ServerProjectRecord> {
  return request(projectPath(projectId));
}

export function createServerProject(title: string, payload: ServerProjectPayload): Promise<ServerProjectRecord> {
  return request("/projects", post({ title, payload }));
}

export function updateServerProject(
  projectId: string,
  title: string,
  payload: ServerProjectPayload,
  expectedVersion: number,
): Promise<ServerProjectRecord> {
  return request(projectPath(projectId), {
    method: "PUT",
    body: JSON.stringify({ title, payload, expected_version: expectedVersion }),
  });
}

export function deleteServerProject(projectId: string): Promise<void> {
  return request(projectPath(projectId), { method: "DELETE" });
}

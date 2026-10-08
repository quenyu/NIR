import type { Diagram } from "../types/diagram";
import type {
  SimulationRequestPayload,
  SimulationResponse,
  PIDTuneResponse,
  AnalyzeResponse,
  ObserverExperimentRequestPayload,
  ObserverExperimentResponse,
  OutputFeedbackRequestPayload,
  OutputFeedbackResponse,
  SafeLearningRequestPayload,
  SafeLearningResponse,
  SystemAnalysis,
  ValidateResponse
} from "../types/api";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

export class SimulationApiError extends Error {
  public readonly validationErrors: string[];

  constructor(message: string, validationErrors: string[] = []) {
    super(message);
    this.validationErrors = validationErrors;
  }
}

export async function tunePidController(payload: {
  diagram: Diagram;
  controller_block_id: string;
  t_end: number;
  dt: number;
  max_iterations?: number;
}): Promise<PIDTuneResponse> {
  const response = await fetch(`${API_BASE_URL}/tune/pid`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const parsed = (await response.json()) as PIDTuneResponse & { detail?: unknown };
  if (!response.ok || !parsed.success) {
    const detail = typeof parsed.detail === "string" ? parsed.detail : "Не удалось настроить PID-регулятор.";
    throw new Error(detail);
  }
  return parsed;
}

export async function validateDiagram(diagram: Diagram): Promise<ValidateResponse> {
  const response = await fetch(`${API_BASE_URL}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ diagram })
  });
  if (!response.ok) {
    throw new Error(`Запрос проверки завершился с ошибкой (HTTP ${response.status}).`);
  }
  return (await response.json()) as ValidateResponse;
}

export async function simulateDiagram(
  payload: SimulationRequestPayload
): Promise<SimulationResponse> {
  const response = await fetch(`${API_BASE_URL}/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const parsed = (await response.json()) as SimulationResponse;
  if (!response.ok || !parsed.success) {
    throw new SimulationApiError(
      `Моделирование завершилось с ошибкой (HTTP ${response.status}).`,
      parsed.validation_errors ?? []
    );
  }
  return parsed;
}

export async function analyzeDiagram(diagram: Diagram): Promise<SystemAnalysis> {
  const response = await fetch(`${API_BASE_URL}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ diagram })
  });
  const parsed = (await response.json()) as AnalyzeResponse & { detail?: unknown };
  if (!response.ok || !parsed.success) {
    const details = parsed.validation_errors?.length
      ? parsed.validation_errors.join(" ")
      : typeof parsed.detail === "string"
        ? parsed.detail
        : "Не удалось собрать матрицы A, B, C и D.";
    throw new Error(details);
  }
  return parsed.analysis;
}

function apiErrorMessage(detail: unknown, fallback: string): string {
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail)) {
    return detail.map((item) => String(item)).join(" ");
  }
  return fallback;
}

export async function runSafeControllerLearning(
  payload: SafeLearningRequestPayload,
  signal?: AbortSignal
): Promise<SafeLearningResponse> {
  const response = await fetch(`${API_BASE_URL}/learn/safe-controller`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });
  const parsed = (await response.json()) as SafeLearningResponse & { detail?: unknown };
  if (!response.ok || !parsed.success) {
    throw new Error(apiErrorMessage(parsed.detail, "Не удалось обучить регулятор для выбранной модели."));
  }
  return parsed;
}

export async function runObserverExperiment(
  payload: ObserverExperimentRequestPayload,
  signal?: AbortSignal
): Promise<ObserverExperimentResponse> {
  const response = await fetch(`${API_BASE_URL}/analyze/observer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });
  const parsed = (await response.json()) as ObserverExperimentResponse & { detail?: unknown };
  if (!response.ok || !parsed.success) {
    throw new Error(apiErrorMessage(parsed.detail, "Не удалось синтезировать наблюдатели для выбранной модели."));
  }
  return parsed;
}

export async function runOutputFeedbackExperiment(
  payload: OutputFeedbackRequestPayload,
  signal?: AbortSignal
): Promise<OutputFeedbackResponse> {
  const response = await fetch(`${API_BASE_URL}/analyze/output-feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });
  const parsed = (await response.json()) as OutputFeedbackResponse & { detail?: unknown };
  if (!response.ok || !parsed.success) {
    throw new Error(apiErrorMessage(parsed.detail, "Не удалось рассчитать LQG-контур для выбранной модели."));
  }
  return parsed;
}

import type { Diagram } from "../types/diagram";
import type {
  SimulationRequestPayload,
  SimulationResponse,
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

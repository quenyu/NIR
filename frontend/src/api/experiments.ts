import type {
  ExperimentCatalogResponse,
  ExperimentRunPayload,
  ExperimentRunResponse
} from "../types/experiments";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

function extractErrorMessage(payload: unknown, status: number): string {
  if (
    payload &&
    typeof payload === "object" &&
    "detail" in payload &&
    typeof (payload as { detail: unknown }).detail === "string"
  ) {
    return (payload as { detail: string }).detail;
  }
  return `Запрос experiments завершился с ошибкой (HTTP ${status}).`;
}

export class ExperimentsApiError extends Error {}

export async function fetchExperimentsCatalog(
  signal?: AbortSignal
): Promise<ExperimentCatalogResponse> {
  const response = await fetch(`${API_BASE_URL}/experiments/catalog`, {
    cache: "no-store",
    signal
  });
  const parsed = (await response.json()) as ExperimentCatalogResponse | { detail?: string };
  if (!response.ok) {
    throw new ExperimentsApiError(extractErrorMessage(parsed, response.status));
  }
  return parsed as ExperimentCatalogResponse;
}

export async function runExperiment(
  payload: ExperimentRunPayload,
  signal?: AbortSignal
): Promise<ExperimentRunResponse> {
  const response = await fetch(`${API_BASE_URL}/experiments/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });
  const parsed = (await response.json()) as ExperimentRunResponse | { detail?: string };
  if (!response.ok) {
    throw new ExperimentsApiError(extractErrorMessage(parsed, response.status));
  }
  return parsed as ExperimentRunResponse;
}

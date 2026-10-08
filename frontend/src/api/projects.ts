import type { Diagram } from "../types/diagram";
import type { ProjectSimulationSettings } from "../features/diagramPersistence";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

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

export class ProjectsApiError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function parseError(response: Response): Promise<never> {
  const payload = await response.json().catch(() => null) as { detail?: unknown } | null;
  let message = `Операция с проектом завершилась с ошибкой (HTTP ${response.status}).`;
  if (typeof payload?.detail === "string") {
    message = payload.detail;
  } else if (payload?.detail && typeof payload.detail === "object" && "message" in payload.detail) {
    message = String((payload.detail as { message: unknown }).message);
  } else if (Array.isArray(payload?.detail)) {
    message = payload.detail.map(String).join(" ");
  }
  throw new ProjectsApiError(message, response.status);
}

export async function listServerProjects(): Promise<ServerProjectSummary[]> {
  const response = await fetch(`${API_BASE_URL}/projects`);
  if (!response.ok) return parseError(response);
  const payload = await response.json() as { projects: ServerProjectSummary[] };
  return payload.projects;
}

export async function getServerProject(projectId: string): Promise<ServerProjectRecord> {
  const response = await fetch(`${API_BASE_URL}/projects/${projectId}`);
  if (!response.ok) return parseError(response);
  return response.json() as Promise<ServerProjectRecord>;
}

export async function createServerProject(
  title: string,
  payload: ServerProjectPayload,
): Promise<ServerProjectRecord> {
  const response = await fetch(`${API_BASE_URL}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, payload }),
  });
  if (!response.ok) return parseError(response);
  return response.json() as Promise<ServerProjectRecord>;
}

export async function updateServerProject(
  projectId: string,
  title: string,
  payload: ServerProjectPayload,
  expectedVersion: number,
): Promise<ServerProjectRecord> {
  const response = await fetch(`${API_BASE_URL}/projects/${projectId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, payload, expected_version: expectedVersion }),
  });
  if (!response.ok) return parseError(response);
  return response.json() as Promise<ServerProjectRecord>;
}

export async function deleteServerProject(projectId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/projects/${projectId}`, { method: "DELETE" });
  if (!response.ok) return parseError(response);
}

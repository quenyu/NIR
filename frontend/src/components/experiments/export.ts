import type { ExperimentRunResponse } from "../../types/experiments";

function sanitizeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function buildBaseFilename(result: ExperimentRunResponse): string {
  return `experiment-${sanitizeFilenamePart(result.scenario.slug)}`;
}

function triggerDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function escapeCsvCell(value: string): string {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

function buildSummaryCsv(result: ExperimentRunResponse): string {
  const lines: string[] = [];
  const header = [
    "section",
    "scenario",
    "solver",
    "dt",
    "max_abs_error",
    "rmse",
    "final_value_error",
    "max_abs_diff",
    "rmse_diff",
    "final_value_diff",
    "mean_ms",
    "median_ms",
    "std_ms",
    "min_ms",
    "max_ms",
    "repetitions",
    "generated_at_utc"
  ];

  lines.push(header.join(","));

  for (const row of result.accuracy_rows) {
    lines.push(
      [
        "accuracy",
        result.scenario.slug,
        row.solver,
        row.dt.toString(),
        row.max_abs_error.toString(),
        row.rmse.toString(),
        row.final_value_error.toString(),
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        result.environment.generated_at_utc
      ]
        .map(escapeCsvCell)
        .join(",")
    );
  }

  for (const row of result.solver_comparison_rows) {
    lines.push(
      [
        "solver_comparison",
        result.scenario.slug,
        result.scenario.selected_solvers.join("+"),
        result.scenario.requested_dt.toString(),
        "",
        "",
        "",
        row.max_abs_diff.toString(),
        row.rmse_diff.toString(),
        row.final_value_diff.toString(),
        "",
        "",
        "",
        "",
        "",
        "",
        result.environment.generated_at_utc
      ]
        .map(escapeCsvCell)
        .join(",")
    );
  }

  for (const row of result.benchmark_summary_rows) {
    lines.push(
      [
        "benchmark_summary",
        result.scenario.slug,
        row.solver,
        result.scenario.requested_dt.toString(),
        "",
        "",
        "",
        "",
        "",
        "",
        row.mean_ms.toString(),
        row.median_ms.toString(),
        row.std_ms.toString(),
        row.min_ms.toString(),
        row.max_ms.toString(),
        row.repetitions.toString(),
        result.environment.generated_at_utc
      ]
        .map(escapeCsvCell)
        .join(",")
    );
  }

  return lines.join("\n");
}

export function downloadExperimentResultJson(result: ExperimentRunResponse) {
  triggerDownload(
    `${buildBaseFilename(result)}-result.json`,
    `${JSON.stringify(result, null, 2)}\n`,
    "application/json;charset=utf-8"
  );
}

export function downloadExperimentSummaryCsv(result: ExperimentRunResponse) {
  triggerDownload(
    `${buildBaseFilename(result)}-summary.csv`,
    buildSummaryCsv(result),
    "text/csv;charset=utf-8"
  );
}

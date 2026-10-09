/**
 * One theme for every Plotly chart: black plotting paper, recessive grid,
 * the validated series order from tokens.css and a compact toolbar.
 */

export const SERIES_COLORS = [
  "#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767",
];

const TEXT = "#b7b9bd";
const GRID = "#1d1e21";
const ZERO = "#4a4c51";
const FONT = '"Inter Variable", "Inter", "Segoe UI", system-ui, sans-serif';

export function axis(title: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: { text: title, standoff: 8 },
    gridcolor: GRID,
    zerolinecolor: ZERO,
    linecolor: ZERO,
    tickfont: { family: '"JetBrains Mono", monospace', size: 11, color: TEXT },
    automargin: true,
    ...extra,
  };
}

export function plotLayout(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    paper_bgcolor: "#000000",
    plot_bgcolor: "#000000",
    font: { color: TEXT, family: FONT, size: 13 },
    colorway: SERIES_COLORS,
    hovermode: "x unified",
    hoverlabel: { bgcolor: "#17181a", bordercolor: "#34363a", font: { family: FONT, color: "#ededee" } },
    margin: { l: 56, r: 16, b: 48, t: 16 },
    showlegend: false,
    ...extra,
  };
}

export const PLOT_CONFIG = {
  responsive: true,
  displaylogo: false,
  modeBarButtons: [["zoom2d", "pan2d", "resetScale2d", "toImage"]],
  toImageButtonOptions: { format: "png", filename: "control-lab-plot", scale: 2 },
};

export const STATIC_PLOT_CONFIG = { responsive: true, displayModeBar: false };

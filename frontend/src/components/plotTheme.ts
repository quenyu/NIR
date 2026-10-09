/**
 * One theme for every Plotly chart, mirroring tokens.css: black paper, thin
 * grid, monospace ticks, white first series and a compact toolbar.
 */

// A lone signal is drawn white: the chart title names it, colour carries nothing.
export const SINGLE_SERIES_COLOR = "#f2f2f2";
// Two or more signals: fixed order, never cycled; validated for CVD separation on #000.
export const SERIES_COLORS = [
  "#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767",
];

export function seriesColor(index: number, count: number): string {
  return count === 1 ? SINGLE_SERIES_COLOR : SERIES_COLORS[index % SERIES_COLORS.length];
}

export const MARKER_COLOR = "#ff3b30";
const TEXT = "#8a8a8a";
const GRID = "rgba(255,255,255,0.08)";
const AXIS = "rgba(255,255,255,0.28)";
const MONO = '"Geist Mono", "JetBrains Mono", ui-monospace, monospace';

export function axis(title: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: { text: title, standoff: 10, font: { family: MONO, size: 11, color: TEXT } },
    gridcolor: GRID,
    gridwidth: 1,
    zerolinecolor: AXIS,
    linecolor: AXIS,
    showline: true,
    mirror: true,
    ticks: "",
    tickfont: { family: MONO, size: 11, color: TEXT },
    automargin: true,
    ...extra,
  };
}

export function plotLayout(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    paper_bgcolor: "#000000",
    plot_bgcolor: "#000000",
    font: { color: TEXT, family: MONO, size: 12 },
    colorway: SERIES_COLORS,
    hovermode: "x unified",
    hoverlabel: { bgcolor: "#0a0a0a", bordercolor: AXIS, font: { family: MONO, size: 12, color: "#f2f2f2" } },
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

/**
 * One theme for every Plotly chart, mirroring tokens.css: transparent paper,
 * thin grid, monospace ticks. Series are shades of grey told apart by their
 * dash pattern, so a chart reads the same on screen and on a b/w printout.
 * The colours are live bindings updated by syncPlotTheme() (features/theme).
 */

import type { Theme } from "../features/theme";

interface PlotPalette {
  single: string;
  series: string[];
  secondary: string;
  marker: string;
  text: string;
  grid: string;
  axis: string;
  hoverBg: string;
  hoverText: string;
}

const PALETTES: Record<Theme, PlotPalette> = {
  dark: {
    single: "#ededed", series: ["#ededed", "#a1a1aa"], secondary: "#8b8b94", marker: "#ffffff",
    text: "#a1a1aa", grid: "rgba(255,255,255,0.07)", axis: "#3a3a43", hoverBg: "#1c1c21", hoverText: "#ededed",
  },
  print: {
    single: "#09090b", series: ["#09090b", "#52525b"], secondary: "#52525b", marker: "#09090b",
    text: "#3f3f46", grid: "#e4e4e7", axis: "#a1a1aa", hoverBg: "#ffffff", hoverText: "#09090b",
  },
};

const DASHES = ["solid", "dash", "dot", "dashdot", "longdash", "longdashdot"];

// A lone signal is drawn in the text colour: the chart title names it.
export let SINGLE_SERIES_COLOR = PALETTES.dark.single;
// The second, reference curve (target, comparison) in a lone-signal chart.
export let SECONDARY_COLOR = PALETTES.dark.secondary;
/** Highlighted marks (cursor, current poles). The muted red is kept for instability only. */
export let MARKER_COLOR = PALETTES.dark.marker;
export const UNSTABLE_COLOR = "#c2524a";
let palette = PALETTES.dark;

export function syncPlotTheme(theme: Theme): void {
  palette = PALETTES[theme];
  SINGLE_SERIES_COLOR = palette.single;
  SECONDARY_COLOR = palette.secondary;
  MARKER_COLOR = palette.marker;
}

/** The text colour at a given opacity: guides, bands and cursors in either theme. */
export function ink(alpha: number): string {
  return palette === PALETTES.print ? `rgba(9,9,11,${alpha})` : `rgba(237,237,237,${alpha})`;
}

export function seriesColor(index: number, count: number): string {
  return count === 1 ? palette.single : palette.series[index % palette.series.length];
}

/** Two or more signals differ by dash pattern, in a fixed order. */
export function seriesDash(index: number, count: number): string {
  return count === 1 ? "solid" : DASHES[index % DASHES.length];
}

const MONO = '"JetBrains Mono", ui-monospace, monospace';

export function axis(title: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: { text: title, standoff: 10, font: { family: MONO, size: 12, color: palette.text } },
    gridcolor: palette.grid,
    gridwidth: 1,
    zerolinecolor: palette.axis,
    linecolor: palette.axis,
    showline: true,
    mirror: true,
    ticks: "",
    tickfont: { family: MONO, size: 12, color: palette.text },
    automargin: true,
    ...extra,
  };
}

export function plotLayout(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: palette.text, family: MONO, size: 12 },
    colorway: palette.series,
    hovermode: "x unified",
    hoverlabel: { bgcolor: palette.hoverBg, bordercolor: palette.axis, font: { family: MONO, size: 12, color: palette.hoverText } },
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

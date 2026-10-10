import { prefersReducedMotion } from "./useReducedMotion";

/** Draw every line of a Plotly chart from left to right, as on an oscilloscope. */
export function drawPlotLines(graph: HTMLElement | null, duration = 1400): void {
  if (!graph || prefersReducedMotion()) return;
  graph.querySelectorAll<SVGPathElement>(".scatterlayer .js-line").forEach((path, index) => {
    const length = path.getTotalLength();
    if (!Number.isFinite(length) || length <= 0) return;
    path.animate(
      [
        { strokeDasharray: `${length}`, strokeDashoffset: `${length}` },
        { strokeDasharray: `${length}`, strokeDashoffset: "0" },
      ],
      { duration, delay: index * 120, easing: "cubic-bezier(0.3, 0.6, 0.2, 1)", fill: "backwards" },
    );
  });
}

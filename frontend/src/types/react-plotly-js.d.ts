declare module "react-plotly.js/factory" {
  import type { ComponentType } from "react";

  export default function createPlotlyComponent(plotly: unknown): ComponentType<Record<string, unknown>>;
}

declare module "plotly.js/lib/core" {
  const Plotly: {
    register(modules: unknown[]): void;
  };
  export default Plotly;
}

declare module "plotly.js/lib/scatter" {
  const scatter: unknown;
  export default scatter;
}

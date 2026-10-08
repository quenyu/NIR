declare module "react-plotly.js";

declare module "react-plotly.js/factory" {
  import type { ComponentType } from "react";

  export default function createPlotlyComponent(plotly: unknown): ComponentType<any>;
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

declare module "plotly.js/lib/box" {
  const box: unknown;
  export default box;
}

declare module "plotly.js/lib/histogram" {
  const histogram: unknown;
  export default histogram;
}

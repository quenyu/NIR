import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  define: {
    global: "globalThis",
  },
  resolve: {
    alias: [
      {
        find: /^react-plotly\.js$/,
        replacement: fileURLToPath(
          new URL("./src/components/experiments/ExperimentPlot.tsx", import.meta.url),
        ),
      },
    ],
  },
  server: {
    port: 5173,
    host: "0.0.0.0"
  }
});

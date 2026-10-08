import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const tempDir = resolve(root, ".test-temp-defense-report");
const outputFile = resolve(tempDir, "defenseReport.mjs");

await mkdir(tempDir, { recursive: true });
await build({
  entryPoints: [resolve(root, "src/features/defenseReport.ts")],
  outfile: outputFile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  logLevel: "silent",
});

const { buildDefenseReportHtml } = await import(`${pathToFileURL(outputFile).href}?t=${Date.now()}`);

const system = {
  model_type: "continuous_lti", state_dimension: 2, input_dimension: 1, output_dimension: 1,
  state_labels: ["x1", "x2"], input_blocks: ["u<1>"], output_labels: ["y&1"],
  matrices: { A: [[0, 1], [-6.25, -2.25]], B: [[0], [6.25]], C: [[1, 0]], D: [[0]] },
  poles: [{ real: -1.125, imag: 2.233 }, { real: -1.125, imag: -2.233 }], modes: [],
  characteristic_polynomial: [1, 2.25, 6.25], spectral_abscissa: -1.125, stability_degree: 1.125,
  stability: "stable", controllability: { rank: 2, full_rank: true }, observability: { rank: 2, full_rank: true },
};

const designs = ["full_state_lqr", "luenberger_lqr", "lqg"].map((method) => ({
  method, name: method, feedback_gain: [[1, 1]], controller_poles: [{ real: 0.7, imag: 0 }],
  observer_poles: method === "full_state_lqr" ? [] : [{ real: 0.4, imag: 0 }],
  augmented_poles: [{ real: 0.7, imag: 0 }], spectral_radius: 0.7, asymptotically_stable: true,
  separation_matches: method === "full_state_lqr" ? null : true, interpretation: "test",
}));
const metrics = ["full_state_lqr", "luenberger_lqr", "lqg"].map((method) => ({
  method, state_rms: 0.2, final_state_norm: 0.01, peak_state_norm: 1, output_rms: 0.8,
  control_rms: 0.3, peak_control: 1, saturation_percent: 0, quadratic_cost_per_step: 0.5,
  tracking_rmse: 0.02, final_output: 0.99, steady_state_error: 0.01,
  estimation_rmse: method === "full_state_lqr" ? null : 0.015, final_estimation_error_norm: 0.01,
}));
const time = [0, 1, 2, 3];
const result = {
  success: true,
  model: { state_dimension: 2, input_dimension: 1, output_dimension: 1, input_block_id: "u<1>", output_label: "y&1", state_labels: ["x1", "x2"], controllability_rank: 2, observability_rank: 2, fully_controllable: true, fully_observable: true, Ad: [[1, 0], [0, 1]], Bd_control: [[0], [1]], C_measurement: [[1, 0]], D_measurement_control: 0, prefilter_gain: 1, equilibrium_state: [1, 0], equilibrium_control: 1 },
  settings: { sample_time: 0.02, horizon: 3, state_weight: 1, control_weight: 0.1, control_limit: 5, reference: 1, process_noise_std_per_sample: 0.002, measurement_noise_std: 0.01, initial_state_scale: 1, seed: 42, luenberger_desired_poles: [0.4, 0.5], lqr_riccati_matrix: [[1, 0], [0, 1]], kalman_covariance: [[1, 0], [0, 1]] },
  designs, metrics,
  trace: { time, state_labels: ["x1", "x2"], full_state_states: [], luenberger_states: [], kalman_states: [], luenberger_estimates: [], kalman_estimates: [], full_state_norm: [], luenberger_state_norm: [], kalman_state_norm: [], luenberger_estimation_error_norm: [], kalman_estimation_error_norm: [], full_state_output: [0, 0.7, 0.94, 0.99], luenberger_output: [0, 0.66, 0.93, 0.99], kalman_output: [0, 0.65, 0.92, 0.99], full_state_control: [], luenberger_control: [], kalman_control: [] },
  warnings: [],
};

const html = buildDefenseReportHtml({ system, result, generatedAt: new Date("2026-07-23T10:30:00Z") });
assert.match(html, /Протокол демонстрационного эксперимента/);
assert.match(html, /условия выполнены/);
assert.match(html, /Принцип разделения/);
assert.match(html, /<svg class="tracking-chart"/);
assert.ok(!html.includes("u<1>"), "HTML must escape block labels");
assert.match(html, /u&lt;1&gt;/);
assert.match(html, /y&amp;1/);
assert.match(html, /Печать \/ PDF/);

await rm(tempDir, { recursive: true, force: true });
console.log("PASS printable defense report");

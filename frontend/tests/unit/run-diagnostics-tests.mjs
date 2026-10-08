import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const tempDir = resolve(root, ".test-temp-diagnostics");
const outputFile = resolve(tempDir, "modelDiagnostics.mjs");
const examplesOutputFile = resolve(tempDir, "examples.mjs");

await mkdir(tempDir, { recursive: true });
await build({
  entryPoints: [resolve(root, "src/features/modelDiagnostics.ts")],
  outfile: outputFile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  logLevel: "silent",
});
await build({
  entryPoints: [resolve(root, "src/pages/examples.ts")],
  outfile: examplesOutputFile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  logLevel: "silent",
});

const diagnostics = await import(`${pathToFileURL(outputFile).href}?t=${Date.now()}`);
const { EXAMPLE_PRESETS } = await import(
  `${pathToFileURL(examplesOutputFile).href}?t=${Date.now()}`
);

const step = () => ({
  id: "step1",
  type: "StepInput",
  parameters: { amplitude: 1, t0: 0 },
  input_ports: [],
  output_ports: ["out"],
});
const scope = () => ({
  id: "scope1",
  type: "Scope",
  parameters: { label: "y" },
  input_ports: ["in"],
  output_ports: [],
});
const connection = (from_block, to_block, to_port = "in") => ({
  from_block,
  from_port: "out",
  to_block,
  to_port,
});

function run(name, callback) {
  try {
    callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("accepts a complete forward path", () => {
  const report = diagnostics.diagnoseDiagram({
    blocks: [step(), scope()],
    connections: [connection("step1", "scope1")],
  });
  assert.equal(report.canRun, true);
  assert.equal(report.counts.error, 0);
  assert.ok(report.issues.some((issue) => issue.code === "model-ready"));
});

run("accepts every built-in example", () => {
  for (const preset of EXAMPLE_PRESETS) {
    const report = diagnostics.diagnoseDiagram(preset.diagram);
    assert.equal(
      report.canRun,
      true,
      `${preset.id}: ${report.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
});

run("finds an unconnected required input and missing forward path", () => {
  const report = diagnostics.diagnoseDiagram({
    blocks: [step(), scope()],
    connections: [],
  });
  assert.equal(report.canRun, false);
  assert.ok(
    report.issues.some(
      (issue) =>
        issue.code === "required-input-unconnected" &&
        issue.nodeId === "scope1" &&
        issue.portId === "in",
    ),
  );
  assert.ok(report.issues.some((issue) => issue.code === "missing-forward-path"));
});

run("reports a non-numeric dynamic parameter", () => {
  const lag = {
    id: "lag1",
    type: "FirstOrderLag",
    parameters: { k: 1, T: "not-a-number", y0: 0 },
    input_ports: ["in"],
    output_ports: ["out"],
  };
  const report = diagnostics.diagnoseDiagram({
    blocks: [step(), lag, scope()],
    connections: [connection("step1", "lag1"), connection("lag1", "scope1")],
  });
  const issue = report.issues.find(
    (candidate) => candidate.code === "invalid-parameter" && candidate.nodeId === "lag1",
  );
  assert.equal(issue?.portId, "T");
  assert.equal(issue?.severity, "error");
});

run("accepts feedback containing a dynamic block", () => {
  const sum = {
    id: "sum1",
    type: "Sum",
    parameters: { signs: ["+", "-"] },
    input_ports: ["in1", "in2"],
    output_ports: ["out"],
  };
  const lag = {
    id: "lag1",
    type: "FirstOrderLag",
    parameters: { k: 1, T: 1, y0: 0 },
    input_ports: ["in"],
    output_ports: ["out"],
  };
  const report = diagnostics.diagnoseDiagram({
    blocks: [step(), sum, lag, scope()],
    connections: [
      connection("step1", "sum1", "in1"),
      connection("sum1", "lag1"),
      connection("lag1", "sum1", "in2"),
      connection("lag1", "scope1"),
    ],
  });
  assert.equal(report.canRun, true);
  assert.ok(report.issues.some((issue) => issue.code === "feedback-valid"));
  assert.ok(!report.issues.some((issue) => issue.code === "algebraic-loop"));
});

run("rejects an algebraic feedback loop", () => {
  const sum = {
    id: "sum1",
    type: "Sum",
    parameters: { signs: ["+", "-"] },
    input_ports: ["in1", "in2"],
    output_ports: ["out"],
  };
  const gain = {
    id: "gain1",
    type: "Gain",
    parameters: { k: 1 },
    input_ports: ["in"],
    output_ports: ["out"],
  };
  const report = diagnostics.diagnoseDiagram({
    blocks: [step(), sum, gain, scope()],
    connections: [
      connection("step1", "sum1", "in1"),
      connection("sum1", "gain1"),
      connection("gain1", "sum1", "in2"),
      connection("gain1", "scope1"),
    ],
  });
  assert.equal(report.canRun, false);
  assert.ok(report.issues.some((issue) => issue.code === "algebraic-loop"));
});

run("preserves React Flow edge IDs in issue references", () => {
  const report = diagnostics.diagnoseFlowModel(
    [
      {
        id: "step1",
        data: {
          blockType: "StepInput",
          parameters: { amplitude: 1, t0: 0 },
          inputPorts: [],
          outputPorts: ["out"],
        },
      },
      {
        id: "scope1",
        data: {
          blockType: "Scope",
          parameters: { label: "y" },
          inputPorts: ["in"],
          outputPorts: [],
        },
      },
    ],
    [
      {
        id: "edge-real-id",
        source: "step1",
        sourceHandle: "out",
        target: "missing-node",
        targetHandle: "in",
      },
    ],
  );
  assert.ok(report.issues.some((issue) => issue.edgeId === "edge-real-id"));
});

run("detects direct feedthrough through a nested subsystem", () => {
  const nested = {
    blocks: [
      { id: "input", type: "SubsystemInput", parameters: { port: "in" }, input_ports: [], output_ports: ["out"] },
      { id: "gain", type: "Gain", parameters: { k: 1 }, input_ports: ["in"], output_ports: ["out"] },
      { id: "output", type: "SubsystemOutput", parameters: { port: "out" }, input_ports: ["in"], output_ports: [] },
    ],
    connections: [connection("input", "gain"), connection("gain", "output")],
  };
  const sum = {
    id: "sum1",
    type: "Sum",
    parameters: { signs: ["+", "-"] },
    input_ports: ["in1", "in2"],
    output_ports: ["out"],
  };
  const subsystem = {
    id: "plant",
    type: "Subsystem",
    parameters: { diagram: nested },
    input_ports: ["in"],
    output_ports: ["out"],
  };
  const report = diagnostics.diagnoseDiagram({
    blocks: [step(), sum, subsystem, scope()],
    connections: [
      connection("step1", "sum1", "in1"),
      connection("sum1", "plant"),
      connection("plant", "sum1", "in2"),
      connection("plant", "scope1"),
    ],
  });
  assert.ok(report.issues.some((issue) => issue.code === "algebraic-loop"));
});

await rm(tempDir, { recursive: true, force: true });
console.log("All diagnostics tests passed.");

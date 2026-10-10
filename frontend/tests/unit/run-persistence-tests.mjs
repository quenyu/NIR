import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const tempDir = resolve(root, ".test-temp");
const outputFile = resolve(tempDir, "diagramPersistence.mjs");

await mkdir(tempDir, { recursive: true });
await build({
  entryPoints: [resolve(root, "src/features/diagramPersistence.ts")],
  outfile: outputFile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  logLevel: "silent"
});

const persistence = await import(`${pathToFileURL(outputFile).href}?t=${Date.now()}`);

const validProject = {
  format: "nir-dynamics-project",
  version: 1,
  metadata: {
    title: "Unit test",
    exported_at: "2026-07-07T12:00:00.000Z",
    generator: "node-test"
  },
  diagram: {
    blocks: [
      {
        id: "step1",
        type: "StepInput",
        parameters: { amplitude: 1, t0: 0 },
        input_ports: [],
        output_ports: ["out"]
      },
      {
        id: "scope1",
        type: "Scope",
        parameters: { label: "y" },
        input_ports: ["in"],
        output_ports: []
      }
    ],
    connections: [
      {
        from_block: "step1",
        from_port: "out",
        to_block: "scope1",
        to_port: "in"
      }
    ]
  },
  layout: {
    positions: {
      step1: { x: 100, y: 100 },
      scope1: { x: 400, y: 100 }
    },
    viewport: { x: 0, y: 0, zoom: 1 }
  },
  simulation: {
    solver: "solve_ivp",
    t_start: 0,
    t_end: 6,
    dt: 0.01
  }
};

function run(name, callback) {
  try {
    callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("parses a valid versioned project", () => {
  const parsed = persistence.parseDiagramProjectJson(JSON.stringify(validProject));
  assert.equal(parsed.project.metadata.title, "Unit test");
  assert.equal(parsed.project.diagram.blocks.length, 2);
  assert.equal(parsed.project.simulation.dt, 0.01);
  assert.deepEqual(parsed.project.layout.positions.scope1, { x: 400, y: 100 });
});

run("rejects a dangling connection", () => {
  const broken = structuredClone(validProject);
  broken.diagram.connections[0].to_block = "missing";
  assert.throws(
    () => persistence.parseDiagramProjectJson(JSON.stringify(broken)),
    (error) =>
      error instanceof persistence.ProjectFileError &&
      error.details.some((detail) => detail.includes("не найден"))
  );
});

run("rejects an unsupported version", () => {
  const broken = { ...validProject, version: 99 };
  assert.throws(
    () => persistence.parseDiagramProjectJson(JSON.stringify(broken)),
    persistence.ProjectFileError
  );
});

run("imports a legacy raw diagram with generated positions", () => {
  const parsed = persistence.parseDiagramProjectJson(
    JSON.stringify(validProject.diagram)
  );
  assert.equal(parsed.project.version, 1);
  assert.equal(parsed.project.metadata.generator, "legacy-json");
  assert.ok(parsed.project.layout.positions.step1);
  assert.ok(parsed.warnings.length > 0);
});

run("serializes a project as formatted JSON", () => {
  const text = persistence.serializeDiagramProject(validProject);
  assert.ok(text.endsWith("\n"));
  assert.equal(JSON.parse(text).format, "nir-dynamics-project");
});

run("validates and preserves a hierarchical subsystem", () => {
  const hierarchical = structuredClone(validProject);
  hierarchical.diagram.blocks = [
    validProject.diagram.blocks[0],
    {
      id: "plant",
      type: "Subsystem",
      parameters: {
        diagram: {
          blocks: [
            { id: "input", type: "SubsystemInput", parameters: { port: "in" }, input_ports: [], output_ports: ["out"] },
            { id: "gain", type: "Gain", parameters: { k: 2 }, input_ports: ["in"], output_ports: ["out"] },
            { id: "output", type: "SubsystemOutput", parameters: { port: "out" }, input_ports: ["in"], output_ports: [] }
          ],
          connections: [
            { from_block: "input", from_port: "out", to_block: "gain", to_port: "in" },
            { from_block: "gain", from_port: "out", to_block: "output", to_port: "in" }
          ]
        }
      },
      input_ports: ["in"],
      output_ports: ["out"]
    },
    validProject.diagram.blocks[1]
  ];
  hierarchical.diagram.connections = [
    { from_block: "step1", from_port: "out", to_block: "plant", to_port: "in" },
    { from_block: "plant", from_port: "out", to_block: "scope1", to_port: "in" }
  ];
  hierarchical.layout.positions.plant = { x: 250, y: 100 };

  const parsed = persistence.parseDiagramProjectJson(JSON.stringify(hierarchical));
  assert.equal(parsed.project.diagram.blocks[1].type, "Subsystem");
  assert.equal(parsed.project.diagram.blocks[1].parameters.diagram.blocks[1].id, "gain");
});

run("rejects a broken diagram inside a subsystem", () => {
  const broken = structuredClone(validProject);
  broken.diagram.blocks[1] = {
    id: "plant",
    type: "Subsystem",
    parameters: {
      diagram: {
        blocks: [
          { id: "input", type: "SubsystemInput", parameters: { port: "in" }, input_ports: [], output_ports: ["out"] },
          { id: "output", type: "SubsystemOutput", parameters: { port: "out" }, input_ports: ["in"], output_ports: [] }
        ],
        connections: []
      }
    },
    input_ports: ["in"],
    output_ports: ["out"]
  };
  broken.diagram.connections[0].to_block = "plant";

  assert.throws(
    () => persistence.parseDiagramProjectJson(JSON.stringify(broken)),
    (error) =>
      error instanceof persistence.ProjectFileError &&
      error.details.some((detail) => detail.includes("parameters.diagram"))
  );
});

await rm(tempDir, { recursive: true, force: true });
console.log("All persistence tests passed.");

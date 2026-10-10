import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const tempDir = resolve(root, ".test-temp-layout");
const outputFile = resolve(tempDir, "modelingWorkspace.mjs");

await mkdir(tempDir, { recursive: true });
await build({
  entryPoints: [resolve(root, "src/features/modelingWorkspace.ts")],
  outfile: outputFile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  logLevel: "silent",
});

const workspace = await import(`${pathToFileURL(outputFile).href}?t=${Date.now()}`);

function node(id, x, y = 170) {
  return {
    id,
    type: "block",
    position: { x, y },
    data: {
      blockId: id,
      blockType: "Subsystem",
      parameters: { name: id },
      inputPorts: ["in"],
      outputPorts: ["out"],
    },
  };
}

function run(name, callback) {
  try {
    callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("migrates the old five-subsystem preset without collisions", () => {
  const normalized = workspace.normalizeNodePositions([
    node("reference", 20),
    node("controller", 230),
    node("drive", 440),
    node("motor", 650),
    node("measurement", 860),
  ]);
  const minimumPitch = workspace.NODE_LAYOUT_WIDTH + workspace.NODE_LAYOUT_GAP_X;
  for (let index = 1; index < normalized.length; index += 1) {
    assert.ok(
      normalized[index].position.x - normalized[index - 1].position.x >= minimumPitch,
      `${normalized[index - 1].id} overlaps ${normalized[index].id}`,
    );
  }
});

run("preserves a feedback lane below the forward signal row", () => {
  const normalized = workspace.normalizeNodePositions([
    node("sum", 260, 160),
    node("plant", 440, 160),
    node("feedback", 440, 320),
  ]);
  assert.deepEqual(normalized[2].position, { x: 440, y: 320 });
});

run("moves a dropped block to the next free horizontal slot", () => {
  const existing = [node("first", 80, 120)];
  const position = workspace.freeNodePosition(existing, { x: 90, y: 130 }, node("candidate", 0).data);
  assert.equal(
    position.x,
    80 + workspace.NODE_LAYOUT_WIDTH + workspace.NODE_LAYOUT_GAP_X,
  );
});

run("uses the same collision-free pitch for automatic positions", () => {
  const left = workspace.defaultPosition(0);
  const right = workspace.defaultPosition(1);
  assert.equal(right.x - left.x, workspace.NODE_LAYOUT_WIDTH + workspace.NODE_LAYOUT_GAP_X);
});

await rm(tempDir, { recursive: true, force: true });
console.log("All layout tests passed.");

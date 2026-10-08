import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const tokens = await readFile(new URL("../../src/styles/tokens.css", import.meta.url), "utf8");
const css = await readFile(new URL("../../src/styles/axiom.css", import.meta.url), "utf8");
const main = await readFile(new URL("../../src/main.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("../../src/pages/MainPage.tsx", import.meta.url), "utf8");
const modeling = await readFile(new URL("../../src/features/modelingWorkspace.ts", import.meta.url), "utf8");
const inspector = await readFile(new URL("../../src/components/workspace/WorkspaceInspector.tsx", import.meta.url), "utf8");
const stateSpace = await readFile(new URL("../../src/components/simulation/StateSpacePanel.tsx", import.meta.url), "utf8");
const experiments = await readFile(new URL("../../src/pages/ExperimentsPage.tsx", import.meta.url), "utf8");

const checks = [
  ["loads one final skin without legacy theme stacking", () => {
    assert.match(main, /styles\/axiom\.css/);
    assert.doesNotMatch(main, /monochrome\.css|linear-instrument\.css|mission-control\.css|orbital-grid\.css|signal-modules\.css/);
    assert.match(css, /Control Lab interface/);
  }],
  ["uses the black neutral and ember palette", () => {
    assert.match(tokens, /--color-void:\s*#000000/);
    assert.match(tokens, /--color-carbon:\s*#111111/);
    assert.match(tokens, /--color-iron:\s*#202020/);
    assert.match(tokens, /--color-paper:\s*#eeeeee/);
    assert.match(tokens, /--color-ember:\s*#da5c2c/);
  }],
  ["ships JetBrains Mono with Cyrillic support as the universal face", () => {
    assert.match(main, /@fontsource\/jetbrains-mono\/400\.css/);
    assert.match(main, /@fontsource\/jetbrains-mono\/700\.css/);
    assert.match(tokens, /--font-berkeley:\s*"JetBrains Mono"/);
    assert.doesNotMatch(main, /space-grotesk|fontsource-variable\/inter/);
  }],
  ["keeps the command bar and instrument rail structurally flat", () => {
    assert.match(css, /\.app-header\s*\{[\s\S]*?background:\s*var\(--color-void\)/);
    assert.match(css, /\.mission-rail\s*\{[\s\S]*?background:\s*var\(--color-void\)/);
    assert.match(workspace, /<WorkspaceRail/);
  }],
  ["renders one quiet 32 pixel engineering grid", () => {
    assert.match(css, /background-size:\s*32px 32px/);
    assert.match(workspace, /BackgroundVariant\.Lines/);
    assert.match(workspace, /gap=\{30\}/);
  }],
  ["uses compact aligned signal modules without clipped-card effects", () => {
    assert.match(css, /\.block-node,[\s\S]*?width:\s*224px;[\s\S]*?min-height:\s*104px/);
    assert.match(css, /\.block-node::before,[\s\S]*?display:\s*none/);
    assert.doesNotMatch(css, /clip-path:\s*polygon/);
    assert.match(modeling, /NODE_LAYOUT_WIDTH = 224/);
    assert.match(modeling, /NODE_LAYOUT_MIN_HEIGHT = 104/);
    assert.match(modeling, /NODE_LAYOUT_GAP_X = 48/);
  }],
  ["keeps node copy readable and removes generic port captions", () => {
    assert.match(css, /\.block-node__title\s*\{[\s\S]*?font-size:\s*13px/);
    assert.match(css, /\.block-node__id,[\s\S]*?font-size:\s*10px/);
    assert.match(css, /\.block-node__port-label\.is-generic\s*\{[\s\S]*?display:\s*none/);
  }],
  ["uses the five generated instrument plates in their semantic states", () => {
    assert.match(workspace, /axiom-signal-flow\.png/);
    assert.match(inspector, /axiom-hierarchy-flow\.png/);
    assert.match(stateSpace, /axiom-state-space\.png/);
    assert.match(experiments, /axiom-experiment-analysis\.png/);
    assert.match(experiments, /axiom-processing-strip\.png/);
    assert.doesNotMatch(css, /box-shadow:\s*[^;]*orange|text-shadow/);
  }],
  ["uses only two-pixel container radii and no floating shadows", () => {
    assert.match(tokens, /--radius-control:\s*2px/);
    assert.match(tokens, /--shadow-float:\s*none/);
    assert.match(css, /\.library-pane,[\s\S]*?border-radius:\s*0;[\s\S]*?box-shadow:\s*none/);
    assert.match(css, /\.parameter-modal,[\s\S]*?border-radius:\s*2px/);
  }],
  ["keeps plots and the result dock on black plotting paper", () => {
    assert.match(css, /\.scope-dock\s*\{[\s\S]*?background:\s*var\(--color-void\)/);
    assert.match(css, /\.scope-content\s*\{[\s\S]*?background:\s*var\(--color-void\)/);
  }],
];

for (const [name, check] of checks) {
  await check();
  console.log(`PASS ${name}`);
}

console.log("All visual contract tests passed.");

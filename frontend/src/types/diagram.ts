export type BlockType =
  | "StepInput"
  | "Gain"
  | "Sum"
  | "Integrator"
  | "FirstOrderLag"
  | "SecondOrderOscillator"
  | "TransferFunction"
  | "ButterworthLPF"
  | "PIDController"
  | "Subsystem"
  | "SubsystemInput"
  | "SubsystemOutput"
  | "Scope";

export const BLOCK_TYPES: BlockType[] = [
  "StepInput",
  "Gain",
  "Sum",
  "Integrator",
  "FirstOrderLag",
  "SecondOrderOscillator",
  "TransferFunction",
  "ButterworthLPF",
  "PIDController",
  "Subsystem",
  "SubsystemInput",
  "SubsystemOutput",
  "Scope"
];

const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  StepInput: "Ступенчатый вход",
  Gain: "Усиление",
  Sum: "Сумматор",
  Integrator: "Интегратор",
  FirstOrderLag: "Звено 1-го порядка",
  SecondOrderOscillator: "Звено 2-го порядка",
  TransferFunction: "Передаточная функция",
  ButterworthLPF: "ФНЧ Баттерворта",
  PIDController: "PID-регулятор",
  Subsystem: "Подсистема",
  SubsystemInput: "Вход подсистемы",
  SubsystemOutput: "Выход подсистемы",
  Scope: "Осциллограф"
};

export function blockTypeLabel(type: BlockType): string {
  return BLOCK_TYPE_LABELS[type];
}

export function subsystemDisplayName(
  parameters: Record<string, unknown>,
  fallback = "Подсистема",
): string {
  const rawName = parameters.name;
  if (typeof rawName === "string" && rawName.trim().length > 0) {
    return rawName.trim();
  }
  const readableFallback = fallback.replace(/[_-]+/g, " ").trim();
  return readableFallback.length > 0 ? readableFallback : "Подсистема";
}

export interface DiagramBlock {
  id: string;
  type: BlockType;
  parameters: Record<string, unknown>;
  input_ports: string[];
  output_ports: string[];
}

export interface DiagramConnection {
  from_block: string;
  from_port: string;
  to_block: string;
  to_port: string;
}

export interface Diagram {
  blocks: DiagramBlock[];
  connections: DiagramConnection[];
}

export interface BlockNodeData {
  blockId: string;
  blockType: BlockType;
  parameters: Record<string, unknown>;
  inputPorts: string[];
  outputPorts: string[];
}

const DEFAULT_SUBSYSTEM_DIAGRAM: Diagram = {
  blocks: [
    {
      id: "input",
      type: "SubsystemInput",
      parameters: { port: "in" },
      input_ports: [],
      output_ports: ["out"]
    },
    {
      id: "gain",
      type: "Gain",
      parameters: { k: 1 },
      input_ports: ["in"],
      output_ports: ["out"]
    },
    {
      id: "output",
      type: "SubsystemOutput",
      parameters: { port: "out" },
      input_ports: ["in"],
      output_ports: []
    }
  ],
  connections: [
    { from_block: "input", from_port: "out", to_block: "gain", to_port: "in" },
    { from_block: "gain", from_port: "out", to_block: "output", to_port: "in" }
  ]
};

const DEFAULT_PARAMETERS: Record<BlockType, Record<string, unknown>> = {
  StepInput: { amplitude: 1, t0: 0 },
  Gain: { k: 1 },
  Sum: { signs: ["+", "-"] },
  Integrator: { k: 1, y0: 0 },
  FirstOrderLag: { k: 1, T: 1, y0: 0 },
  SecondOrderOscillator: { k: 1, wn: 1, zeta: 0.2, y0: 0, v0: 0 },
  TransferFunction: { numerator: [1], denominator: [1, 1] },
  ButterworthLPF: { order: 2, cutoff_freq: 10, y0: 0 },
  PIDController: { kp: 1, ki: 0, kd: 0, filter_n: 20 },
  Subsystem: {
    name: "Новая подсистема",
    diagram: DEFAULT_SUBSYSTEM_DIAGRAM,
    layout: {
      positions: {
        input: { x: 40, y: 140 },
        gain: { x: 280, y: 140 },
        output: { x: 520, y: 140 }
      }
    }
  },
  SubsystemInput: { port: "in" },
  SubsystemOutput: { port: "out" },
  Scope: { label: "" }
};

export function isBlockType(value: string): value is BlockType {
  return BLOCK_TYPES.includes(value as BlockType);
}

export function defaultParametersFor(type: BlockType): Record<string, unknown> {
  const source = DEFAULT_PARAMETERS[type];
  return structuredClone(source);
}

/**
 * Signs of a Sum block, read exactly like backend get_signs(): a missing value
 * means the default ["+", "-"], every list item becomes one input port, and
 * invalid items are kept so that validation can point at them.
 */
export function normalizedSigns(raw: unknown): string[] {
  if (raw === undefined || raw === null) {
    return ["+", "-"];
  }
  return Array.isArray(raw) ? raw.map((item) => String(item)) : [];
}

export function subsystemDiagram(parameters: Record<string, unknown>): Diagram | null {
  const raw = parameters.diagram;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const candidate = raw as Partial<Diagram>;
  if (!Array.isArray(candidate.blocks) || !Array.isArray(candidate.connections)) {
    return null;
  }
  return candidate as Diagram;
}

function subsystemInterfacePorts(
  parameters: Record<string, unknown>,
  interfaceType: "SubsystemInput" | "SubsystemOutput"
): string[] {
  const diagram = subsystemDiagram(parameters);
  if (!diagram) {
    return [];
  }
  return diagram.blocks
    .filter((block) => block.type === interfaceType)
    .map((block) => String(block.parameters.port ?? "").trim())
    .filter((port) => port.length > 0);
}

export function inputPortsFor(
  type: BlockType,
  parameters: Record<string, unknown>
): string[] {
  if (type === "StepInput" || type === "SubsystemInput") {
    return [];
  }
  if (type === "Subsystem") {
    return subsystemInterfacePorts(parameters, "SubsystemInput");
  }
  if (type === "Sum") {
    const signs = normalizedSigns(parameters.signs);
    return signs.map((_, index) => `in${index + 1}`);
  }
  return ["in"];
}

export function outputPortsFor(
  type: BlockType,
  parameters: Record<string, unknown> = {}
): string[] {
  if (type === "Scope" || type === "SubsystemOutput") {
    return [];
  }
  if (type === "Subsystem") {
    return subsystemInterfacePorts(parameters, "SubsystemOutput");
  }
  return ["out"];
}

export type BlockType =
  | "StepInput"
  | "Gain"
  | "Sum"
  | "Integrator"
  | "FirstOrderLag"
  | "SecondOrderOscillator"
  | "TransferFunction"
  | "Scope";

export const BLOCK_TYPES: BlockType[] = [
  "StepInput",
  "Gain",
  "Sum",
  "Integrator",
  "FirstOrderLag",
  "SecondOrderOscillator",
  "TransferFunction",
  "Scope"
];

export const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  StepInput: "Ступенчатый вход",
  Gain: "Усиление",
  Sum: "Сумматор",
  Integrator: "Интегратор",
  FirstOrderLag: "Звено 1-го порядка",
  SecondOrderOscillator: "Звено 2-го порядка",
  TransferFunction: "TransferFunction",
  Scope: "Осциллограф"
};

export function blockTypeLabel(type: BlockType): string {
  return BLOCK_TYPE_LABELS[type];
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

const DEFAULT_PARAMETERS: Record<BlockType, Record<string, unknown>> = {
  StepInput: { amplitude: 1, t0: 0 },
  Gain: { k: 1 },
  Sum: { signs: ["+", "-"] },
  Integrator: { k: 1, y0: 0 },
  FirstOrderLag: { k: 1, T: 1, y0: 0 },
  SecondOrderOscillator: { k: 1, wn: 1, zeta: 0.2, y0: 0, v0: 0 },
  TransferFunction: { numerator: [1], denominator: [1, 1] },
  Scope: { label: "" }
};

export function isBlockType(value: string): value is BlockType {
  return BLOCK_TYPES.includes(value as BlockType);
}

export function defaultParametersFor(type: BlockType): Record<string, unknown> {
  const source = DEFAULT_PARAMETERS[type];
  return structuredClone(source);
}

export function normalizedSigns(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return ["+", "-"];
  }
  const parsed = raw
    .map((item) => String(item).trim())
    .filter((item) => item === "+" || item === "-");
  return parsed.length > 0 ? parsed : ["+", "-"];
}

export function inputPortsFor(
  type: BlockType,
  parameters: Record<string, unknown>
): string[] {
  if (type === "StepInput") {
    return [];
  }
  if (type === "Sum") {
    const signs = normalizedSigns(parameters.signs);
    return signs.map((_, index) => `in${index + 1}`);
  }
  return ["in"];
}

export function outputPortsFor(type: BlockType): string[] {
  if (type === "Scope") {
    return [];
  }
  return ["out"];
}

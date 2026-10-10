import type { CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import {
  blockTypeLabel,
  normalizedSigns,
  subsystemDisplayName,
  type BlockNodeData,
} from "../types/diagram";

const SUM_MIN_HEIGHT = 80;
const SUM_HEADER_HEIGHT = 30;
const SUM_ROW_HEIGHT = 22;
const SUM_BOTTOM_PADDING = 12;

function verticalOffset(index: number, count: number): string {
  const ratio = (index + 1) / (count + 1);
  return `${ratio * 100}%`;
}

function sumHeight(inputCount: number): number {
  return Math.max(
    SUM_MIN_HEIGHT,
    SUM_HEADER_HEIGHT + Math.max(inputCount, 1) * SUM_ROW_HEIGHT + SUM_BOTTOM_PADDING,
  );
}

function sumMainBusTop(inputCount: number): number {
  return sumHeight(inputCount) / 2;
}

function sumInputTop(index: number, inputCount: number): string {
  const mainBusTop = sumMainBusTop(inputCount);
  if (index === 0) {
    return `${mainBusTop}px`;
  }

  const distance = Math.ceil(index / 2) * SUM_ROW_HEIGHT;
  const direction = index % 2 === 1 ? 1 : -1;
  return `${mainBusTop + direction * distance}px`;
}

function sumOutputTop(inputCount: number): string {
  return `${sumMainBusTop(inputCount)}px`;
}

function portTop(
  data: BlockNodeData,
  side: "input" | "output",
  index: number,
  count: number,
): string {
  if (data.blockType !== "Sum") {
    return verticalOffset(index, count);
  }
  return side === "input"
    ? sumInputTop(index, data.inputPorts.length)
    : sumOutputTop(data.inputPorts.length);
}

function inputLabel(data: BlockNodeData, port: string, index: number): string {
  if (data.blockType !== "Sum") {
    return port;
  }
  const signs = normalizedSigns(data.parameters.signs);
  return signs[index] ?? "+";
}

function isGenericPortLabel(_data: BlockNodeData, port: string): boolean {
  return port === "in" || port === "out";
}

function nodeStyle(data: BlockNodeData): CSSProperties | undefined {
  if (data.blockType !== "Sum") {
    return undefined;
  }
  const height = sumHeight(data.inputPorts.length);
  return { height, minHeight: height };
}

function blockFormula(data: BlockNodeData): string {
  switch (data.blockType) {
    case "StepInput":
      return "u(t)";
    case "Gain":
      return "K";
    case "Sum":
      return "Σ";
    case "Integrator":
      return "1/s";
    case "FirstOrderLag":
      return "K/(Ts+1)";
    case "SecondOrderOscillator":
      return "W₂(s)";
    case "TransferFunction":
      return "W(s)";
    case "ButterworthLPF":
      return "LPF";
    case "PIDController":
      return "PID";
    case "Subsystem":
      return "SUB";
    case "SubsystemInput":
      return "IN";
    case "SubsystemOutput":
      return "OUT";
    case "Scope":
      return "y(t)";
  }
}

function blockGlyph(data: BlockNodeData): string {
  switch (data.blockType) {
    case "StepInput":
      return "u(t)";
    case "Gain":
      return "K";
    case "Sum":
      return "Σ";
    case "Integrator":
      return "∫";
    case "FirstOrderLag":
      return "1°";
    case "SecondOrderOscillator":
      return "2°";
    case "TransferFunction":
      return "W";
    case "ButterworthLPF":
      return "LPF";
    case "PIDController":
      return "PID";
    case "Subsystem":
      return "SUB";
    case "SubsystemInput":
      return "IN";
    case "SubsystemOutput":
      return "OUT";
    case "Scope":
      return "y(t)";
  }
}

function formatNumber(raw: unknown, fallback: number): string {
  const value = typeof raw === "number" ? raw : Number(raw ?? fallback);
  if (!Number.isFinite(value)) return "?";
  return Number.parseFloat(value.toPrecision(4)).toString().replace("-", "−");
}

/** Polynomial in s from coefficients, highest power first: [1, -1] -> "s − 1". */
function polynomial(raw: unknown): string {
  const coefficients = Array.isArray(raw) ? raw.map(Number) : [];
  const degree = coefficients.length - 1;
  const terms: string[] = [];
  coefficients.forEach((coefficient, index) => {
    if (!Number.isFinite(coefficient) || coefficient === 0) return;
    const power = degree - index;
    const magnitude = Math.abs(coefficient);
    const variable = power === 0 ? "" : power === 1 ? "s" : `s${power === 2 ? "²" : power === 3 ? "³" : `^${power}`}`;
    const factor = magnitude === 1 && power > 0 ? "" : formatNumber(magnitude, 0);
    const sign = coefficient < 0 ? "−" : "+";
    terms.push(terms.length === 0 ? `${coefficient < 0 ? "−" : ""}${factor}${variable}` : ` ${sign} ${factor}${variable}`);
  });
  return terms.join("") || "0";
}

function wrap(expression: string): string {
  return /[ +−]/.test(expression.trim().replace(/^−/, "")) ? `(${expression})` : expression;
}

/** The block's defining parameters in one line, e.g. "K = 3" or "1/(s − 1)". */
function blockSummary(data: BlockNodeData): string {
  const p = data.parameters;
  switch (data.blockType) {
    case "StepInput":
      return `A = ${formatNumber(p.amplitude, 1)} · t₀ = ${formatNumber(p.t0, 0)}`;
    case "Gain":
      return `K = ${formatNumber(p.k, 1)}`;
    case "Sum":
      return normalizedSigns(p.signs).join(" ").replace(/-/g, "−");
    case "Integrator":
      return `${formatNumber(p.k, 1)}/s`;
    case "FirstOrderLag":
      return `${formatNumber(p.k, 1)}/(${formatNumber(p.T, 1)}s + 1)`;
    case "SecondOrderOscillator":
      return `ω₀ = ${formatNumber(p.wn, 1)} · ζ = ${formatNumber(p.zeta, 0.2)}`;
    case "TransferFunction":
      return `${wrap(polynomial(p.numerator ?? [1]))}/${wrap(polynomial(p.denominator ?? [1, 1]))}`;
    case "ButterworthLPF":
      return `n = ${formatNumber(p.order, 2)} · ωc = ${formatNumber(p.cutoff_freq, 10)}`;
    case "PIDController":
      return `Kp ${formatNumber(p.kp, 1)} · Ki ${formatNumber(p.ki, 0)} · Kd ${formatNumber(p.kd, 0)}`;
    case "Scope":
      return typeof p.label === "string" && p.label.trim() ? p.label : data.blockId;
    case "SubsystemInput":
    case "SubsystemOutput":
      return typeof p.port === "string" ? p.port : "";
    case "Subsystem":
      return subsystemMeta(data);
  }
}

function subsystemMeta(data: BlockNodeData): string {
  const inputs = data.inputPorts.length;
  const outputs = data.outputPorts.length;
  if (inputs === 1 && outputs === 1) {
    return `${data.inputPorts[0]}  →  ${data.outputPorts[0]}`;
  }
  return `${inputs} IN  →  ${outputs} OUT`;
}

function blockDisplayName(data: BlockNodeData): string {
  if (data.blockType === "Subsystem") {
    return subsystemDisplayName(data.parameters, data.blockId);
  }
  const customName = data.parameters.name;
  if (typeof customName === "string" && customName.trim().length > 0) {
    return customName.trim();
  }
  return blockTypeLabel(data.blockType);
}

export function BlockNode({ data }: NodeProps<BlockNodeData>) {
  const isSubsystem = data.blockType === "Subsystem";
  const title = blockDisplayName(data);
  const connectivityClass = [
    data.inputPorts.length > 0 ? "block-node--has-input" : "block-node--no-input",
    data.outputPorts.length > 0 ? "block-node--has-output" : "block-node--no-output",
  ].join(" ");

  return (
    <div
      className={`block-node ${connectivityClass}`}
      data-testid={`node-${data.blockId}`}
      data-block-type={data.blockType}
      style={nodeStyle(data)}
      title={isSubsystem ? "Двойное нажатие — открыть следующий уровень" : undefined}
    >
      {data.inputPorts.map((port, index) => (
        <Handle
          key={`${data.blockId}-${port}`}
          id={port}
          type="target"
          position={Position.Left}
          title={`${data.blockId}.${port} input`}
          aria-label={`${data.blockId}.${port} input`}
          style={{ top: portTop(data, "input", index, data.inputPorts.length) }}
        />
      ))}

      {data.inputPorts.map((port, index) => (
        <div
          key={`${data.blockId}-${port}-label`}
          className={`block-node__port-label block-node__port-label--input ${isGenericPortLabel(data, port) ? "is-generic" : ""}`}
          style={{ top: portTop(data, "input", index, data.inputPorts.length) }}
          title={`${data.blockId}.${port} input`}
        >
          {inputLabel(data, port, index)}
        </div>
      ))}

      <div className={`block-node__body ${isSubsystem ? "block-node__body--subsystem" : ""}`}>
        <span className="block-node__glyph" title={blockFormula(data)} aria-hidden="true">{blockGlyph(data)}</span>
        <span className="block-node__title" title={title}>{title}</span>
        <div className={isSubsystem ? "block-node__summary subsystem-node__ports" : "block-node__summary"} title={blockFormula(data)}>
          {blockSummary(data)}
        </div>
      </div>

      {data.outputPorts.map((port, index) => (
        <div
          key={`${data.blockId}-${port}-label`}
          className={`block-node__port-label block-node__port-label--output ${isGenericPortLabel(data, port) ? "is-generic" : ""}`}
          style={{ top: portTop(data, "output", index, data.outputPorts.length) }}
          title={`${data.blockId}.${port} output`}
        >
          {port}
        </div>
      ))}

      {data.outputPorts.map((port, index) => (
        <Handle
          key={`${data.blockId}-${port}`}
          id={port}
          type="source"
          position={Position.Right}
          title={`${data.blockId}.${port} output`}
          aria-label={`${data.blockId}.${port} output`}
          style={{ top: portTop(data, "output", index, data.outputPorts.length) }}
        />
      ))}
    </div>
  );
}

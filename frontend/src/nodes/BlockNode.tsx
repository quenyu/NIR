import type { CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { blockTypeLabel, normalizedSigns, type BlockNodeData } from "../types/diagram";

const SUM_MIN_HEIGHT = 96;
const SUM_HEADER_HEIGHT = 52;
const SUM_ROW_HEIGHT = 28;
const SUM_BOTTOM_PADDING = 16;

function verticalOffset(index: number, count: number): string {
  const ratio = (index + 1) / (count + 1);
  return `${ratio * 100}%`;
}

function sumHeight(inputCount: number): number {
  return Math.max(
    SUM_MIN_HEIGHT,
    SUM_HEADER_HEIGHT + Math.max(inputCount, 1) * SUM_ROW_HEIGHT + SUM_BOTTOM_PADDING
  );
}

function sumInputTop(index: number): string {
  return `${SUM_HEADER_HEIGHT + index * SUM_ROW_HEIGHT + SUM_ROW_HEIGHT / 2}px`;
}

function sumOutputTop(inputCount: number): string {
  return `${SUM_HEADER_HEIGHT + (Math.max(inputCount, 1) * SUM_ROW_HEIGHT) / 2}px`;
}

function portTop(
  data: BlockNodeData,
  side: "input" | "output",
  index: number,
  count: number
): string {
  if (data.blockType !== "Sum") {
    return verticalOffset(index, count);
  }
  return side === "input" ? sumInputTop(index) : sumOutputTop(data.inputPorts.length);
}

function inputLabel(data: BlockNodeData, port: string, index: number): string {
  if (data.blockType !== "Sum") {
    return port;
  }
  const signs = normalizedSigns(data.parameters.signs);
  return `${signs[index] ?? "+"} ${port}`;
}

function nodeStyle(data: BlockNodeData): CSSProperties | undefined {
  if (data.blockType !== "Sum") {
    return undefined;
  }
  const height = sumHeight(data.inputPorts.length);
  return { height, minHeight: height };
}

export function BlockNode({ data }: NodeProps<BlockNodeData>) {
  return (
    <div
      className="block-node"
      data-testid={`node-${data.blockId}`}
      data-block-type={data.blockType}
      style={nodeStyle(data)}
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
          className="block-node__port-label block-node__port-label--input"
          style={{ top: portTop(data, "input", index, data.inputPorts.length) }}
          title={`${data.blockId}.${port} input`}
        >
          {inputLabel(data, port, index)}
        </div>
      ))}

      <div className="block-node__title">{blockTypeLabel(data.blockType)}</div>
      <div className="block-node__id">{data.blockId}</div>
      <div className="block-node__ports">
        in:{data.inputPorts.length} / out:{data.outputPorts.length}
      </div>

      {data.outputPorts.map((port, index) => (
        <div
          key={`${data.blockId}-${port}-label`}
          className="block-node__port-label block-node__port-label--output"
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

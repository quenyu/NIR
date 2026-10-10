import type { Edge, Node } from "reactflow";
import { routeDiagramEdges } from "./edgeRouting";
import type { ModelDiagnosticIssue } from "./modelDiagnostics";
import type {
  BlockNodeData,
  Diagram,
  DiagramBlock,
} from "../types/diagram";

export type DiagramNode = Node<BlockNodeData>;

export const NODE_LAYOUT_WIDTH = 184;
const NODE_LAYOUT_MIN_HEIGHT = 80;
export const NODE_LAYOUT_GAP_X = 48;
const NODE_LAYOUT_GAP_Y = 40;

export function nodeLayoutHeight(data: BlockNodeData): number {
  if (data.blockType !== "Sum") {
    return NODE_LAYOUT_MIN_HEIGHT;
  }
  return Math.max(NODE_LAYOUT_MIN_HEIGHT, 30 + Math.max(data.inputPorts.length, 1) * 22 + 12);
}

export function defaultPosition(index: number): { x: number; y: number } {
  const pitchX = NODE_LAYOUT_WIDTH + NODE_LAYOUT_GAP_X;
  const pitchY = NODE_LAYOUT_MIN_HEIGHT + NODE_LAYOUT_GAP_Y + 32;
  return { x: 80 + (index % 4) * pitchX, y: 112 + Math.floor(index / 4) * pitchY };
}

type PositionedNode = Pick<DiagramNode, "position" | "data">;

function overlapsWithClearance(
  left: PositionedNode,
  right: PositionedNode,
): boolean {
  const leftHeight = nodeLayoutHeight(left.data);
  const rightHeight = nodeLayoutHeight(right.data);
  return (
    left.position.x < right.position.x + NODE_LAYOUT_WIDTH + NODE_LAYOUT_GAP_X
    && left.position.x + NODE_LAYOUT_WIDTH + NODE_LAYOUT_GAP_X > right.position.x
    && left.position.y < right.position.y + rightHeight + NODE_LAYOUT_GAP_Y
    && left.position.y + leftHeight + NODE_LAYOUT_GAP_Y > right.position.y
  );
}

/**
 * Migrates layouts created for the old, narrower node cards. Existing rows and
 * feedback lanes stay intact; only colliding nodes are pushed to the right.
 */
export function normalizeNodePositions(nodes: DiagramNode[]): DiagramNode[] {
  const placed: DiagramNode[] = [];

  for (const sourceNode of nodes) {
    const node: DiagramNode = {
      ...sourceNode,
      position: { ...sourceNode.position },
    };
    let attempts = 0;
    while (attempts < nodes.length + 2) {
      const blockers = placed.filter((candidate) => overlapsWithClearance(node, candidate));
      if (blockers.length === 0) {
        break;
      }
      node.position.x = Math.max(
        ...blockers.map((candidate) => candidate.position.x + NODE_LAYOUT_WIDTH + NODE_LAYOUT_GAP_X),
      );
      attempts += 1;
    }
    placed.push(node);
  }

  return placed;
}

/** Finds a collision-free insertion point while keeping the requested row. */
export function freeNodePosition(
  existingNodes: DiagramNode[],
  requested: { x: number; y: number },
  data: BlockNodeData,
): { x: number; y: number } {
  const candidate: DiagramNode = {
    id: "__placement_candidate__",
    type: "block",
    position: { ...requested },
    data,
  };
  let attempts = 0;
  while (attempts < existingNodes.length + 2) {
    const blockers = existingNodes.filter((node) => overlapsWithClearance(candidate, node));
    if (blockers.length === 0) {
      return candidate.position;
    }
    candidate.position.x = Math.max(
      ...blockers.map((node) => node.position.x + NODE_LAYOUT_WIDTH + NODE_LAYOUT_GAP_X),
    );
    attempts += 1;
  }
  return candidate.position;
}

export function toNode(
  block: DiagramBlock,
  position: { x: number; y: number },
): DiagramNode {
  return {
    id: block.id,
    type: "block",
    position,
    data: {
      blockId: block.id,
      blockType: block.type,
      parameters: block.parameters,
      inputPorts: block.input_ports,
      outputPorts: block.output_ports,
    },
  };
}

export function edgesFromDiagram(
  diagram: Diagram,
  positions: Record<string, { x: number; y: number }>,
): Edge[] {
  return routeDiagramEdges(
    diagram.connections.map((connection, index) => ({
      id: `edge-${index}-${connection.from_block}-${connection.to_block}`,
      source: connection.from_block,
      sourceHandle: connection.from_port,
      target: connection.to_block,
      targetHandle: connection.to_port,
    })),
    positions,
  );
}

export function positionsFromNodes(
  nodes: DiagramNode[],
): Record<string, { x: number; y: number }> {
  return Object.fromEntries(nodes.map((node) => [node.id, node.position]));
}

export function positionsFromSubsystemParameters(
  parameters: Record<string, unknown>,
  diagram: Diagram,
): Record<string, { x: number; y: number }> {
  const defaultPositions = () => Object.fromEntries(
    diagram.blocks.map((block, index) => [block.id, defaultPosition(index)]),
  );
  const rawLayout = parameters.layout;
  if (!rawLayout || typeof rawLayout !== "object" || Array.isArray(rawLayout)) {
    return defaultPositions();
  }
  const rawPositions = (rawLayout as Record<string, unknown>).positions;
  if (!rawPositions || typeof rawPositions !== "object" || Array.isArray(rawPositions)) {
    return defaultPositions();
  }
  const positions = rawPositions as Record<string, { x?: unknown; y?: unknown }>;
  return Object.fromEntries(
    diagram.blocks.map((block, index) => {
      const candidate = positions[block.id];
      return [
        block.id,
        candidate && typeof candidate.x === "number" && typeof candidate.y === "number"
          ? { x: candidate.x, y: candidate.y }
          : defaultPosition(index),
      ];
    }),
  );
}

export function russianCountNoun(
  value: number,
  one: string,
  few: string,
  many: string,
): string {
  const absolute = Math.abs(value) % 100;
  const lastDigit = absolute % 10;
  return absolute > 10 && absolute < 20
    ? many
    : lastDigit === 1
      ? one
      : lastDigit >= 2 && lastDigit <= 4
        ? few
        : many;
}

export function formatRussianCount(
  value: number,
  one: string,
  few: string,
  many: string,
): string {
  return `${value} ${russianCountNoun(value, one, few, many)}`;
}

export function diagnosticTitle(issue: ModelDiagnosticIssue): string {
  switch (issue.code) {
    case "invalid-parameter":
      return "Некорректный параметр";
    case "required-input-unconnected":
      return "Разрыв входного сигнала";
    case "output-unconnected":
      return "Неиспользуемый выход";
    case "algebraic-loop":
      return "Алгебраическая петля";
    case "feedback-valid":
      return "Допустимая обратная связь";
    case "missing-forward-path":
      return "Нет сквозного пути";
    case "model-ready":
      return "Схема готова";
    case "model-rejected":
      return "Ошибка модели";
    case "solver-error":
      return "Ошибка численного расчёта";
    case "settings-invalid":
      return "Параметры расчёта";
    case "server-unreachable":
      return "Сервер недоступен";
    case "server-error":
      return "Ошибка сервера";
    default:
      return issue.severity === "error"
        ? "Ошибка структуры"
        : issue.severity === "warning"
          ? "Предупреждение"
          : "Информация";
  }
}

export function blockedSumInputMessage(portName: string): string {
  return `Нельзя удалить вход Sum.${portName}: к нему подключена связь.`;
}

export function diagramFromFlow(nodes: DiagramNode[], edges: Edge[]): Diagram {
  return {
    blocks: nodes.map((node) => ({
      id: node.id,
      type: node.data.blockType,
      parameters: node.data.parameters,
      input_ports: node.data.inputPorts,
      output_ports: node.data.outputPorts,
    })),
    connections: edges.map((edge) => ({
      from_block: edge.source,
      from_port: edge.sourceHandle ?? "out",
      to_block: edge.target,
      to_port: edge.targetHandle ?? "in",
    })),
  };
}

export type StabilityTone = "success" | "warning" | "danger" | "default";

const STABILITY_LABELS: Record<string, { label: string; tone: StabilityTone }> = {
  stable: { label: "Асимптотически устойчива", tone: "success" },
  marginal: { label: "На границе устойчивости", tone: "warning" },
  unstable: { label: "Неустойчива", tone: "danger" },
  not_applicable: { label: "Статическая модель", tone: "default" },
};

export function stabilityPresentation(status: string | undefined): { label: string; tone: StabilityTone } {
  return STABILITY_LABELS[status ?? ""] ?? { label: "Не определена", tone: "default" };
}

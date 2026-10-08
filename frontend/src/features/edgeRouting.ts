import { MarkerType, type Edge } from "reactflow";

export type DiagramEdgeKind = "signal" | "feedback";

export interface DiagramEdgeData extends Record<string, unknown> {
  kind: DiagramEdgeKind;
  lane: number;
  showJunction: boolean;
}

type NodePositions = Record<string, { x: number; y: number }>;

const SIGNAL_COLOR = "#8f9499";
const FEEDBACK_COLOR = "#a4a9ae";

function storedKind(edge: Edge): DiagramEdgeKind | null {
  const kind = edge.data && typeof edge.data === "object"
    ? (edge.data as Record<string, unknown>).kind
    : undefined;
  return kind === "signal" || kind === "feedback" ? kind : null;
}

function inferKind(edge: Edge, positions: NodePositions): DiagramEdgeKind {
  const source = positions[edge.source];
  const target = positions[edge.target];
  return source && target && source.x > target.x ? "feedback" : "signal";
}

function edgeSpan(edge: Edge, positions: NodePositions): number {
  const source = positions[edge.source];
  const target = positions[edge.target];
  return source && target ? Math.abs(source.x - target.x) : 0;
}

function branchKey(edge: Edge): string {
  return `${edge.source}:${edge.sourceHandle ?? "out"}`;
}

/**
 * Assigns stable semantic edge kinds and deterministic feedback lanes.
 * Short feedback loops stay closest to the main signal bus; longer loops
 * receive lower lanes so parallel paths never visually merge.
 */
export function routeDiagramEdges(
  edges: Edge[],
  positions: NodePositions,
): Edge[] {
  const kinds = new Map<string, DiagramEdgeKind>();
  for (const edge of edges) {
    kinds.set(edge.id, storedKind(edge) ?? inferKind(edge, positions));
  }

  const feedbackLane = new Map<string, number>();
  edges
    .filter((edge) => kinds.get(edge.id) === "feedback")
    .sort((left, right) => edgeSpan(left, positions) - edgeSpan(right, positions))
    .forEach((edge, index) => feedbackLane.set(edge.id, index));

  const branches = new Map<string, Edge[]>();
  for (const edge of edges) {
    const key = branchKey(edge);
    branches.set(key, [...(branches.get(key) ?? []), edge]);
  }

  const junctionOwners = new Set<string>();
  for (const branchEdges of branches.values()) {
    if (branchEdges.length < 2) {
      continue;
    }
    const owner = branchEdges.find((edge) => kinds.get(edge.id) === "feedback") ?? branchEdges[0];
    junctionOwners.add(owner.id);
  }

  return edges.map((edge) => {
    const kind = kinds.get(edge.id) ?? "signal";
    const previousData = edge.data && typeof edge.data === "object"
      ? (edge.data as Record<string, unknown>)
      : {};
    const data: DiagramEdgeData = {
      ...previousData,
      kind,
      lane: feedbackLane.get(edge.id) ?? 0,
      showJunction: junctionOwners.has(edge.id),
    };
    const color = kind === "feedback" ? FEEDBACK_COLOR : SIGNAL_COLOR;

    return {
      ...edge,
      type: kind,
      className: kind === "feedback" ? "feedback-edge" : "signal-edge",
      data,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
        width: 14,
        height: 14,
      },
    };
  });
}

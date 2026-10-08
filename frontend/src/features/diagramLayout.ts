import type { Edge, Node } from "reactflow";
import type { BlockNodeData } from "../types/diagram";
import {
  NODE_LAYOUT_WIDTH,
  nodeLayoutHeight,
} from "./modelingWorkspace";

async function createElk() {
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  return new ELK();
}

let elkPromise: ReturnType<typeof createElk> | null = null;

function getElk() {
  elkPromise ??= createElk();
  return elkPromise;
}

type DiagramPosition = { x: number; y: number };

function portId(nodeId: string, side: "input" | "output", port: string): string {
  return `${nodeId}::${side}::${port}`;
}

function nodeSize(node: Node<BlockNodeData>): { width: number; height: number } {
  return {
    width: node.width ?? NODE_LAYOUT_WIDTH,
    height: node.height ?? nodeLayoutHeight(node.data),
  };
}

function primaryChains(nodes: Node<BlockNodeData>[], edges: Edge[]): string[][] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const forwardEdges = edges.filter(
    (edge) => edge.data?.kind !== "feedback" && nodeIds.has(edge.source) && nodeIds.has(edge.target),
  );
  const undirected = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const incomingCount = new Map(nodes.map((node) => [node.id, 0]));

  for (const edge of forwardEdges) {
    undirected.get(edge.source)?.add(edge.target);
    undirected.get(edge.target)?.add(edge.source);
    outgoing.get(edge.source)?.push(edge.target);
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
  }

  const components: string[][] = [];
  const visited = new Set<string>();
  for (const node of nodes) {
    if (visited.has(node.id)) {
      continue;
    }
    const component: string[] = [];
    const queue = [node.id];
    visited.add(node.id);
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }
      component.push(current);
      for (const adjacent of undirected.get(current) ?? []) {
        if (!visited.has(adjacent)) {
          visited.add(adjacent);
          queue.push(adjacent);
        }
      }
    }
    components.push(component);
  }

  return components.map((component) => {
    const componentIds = new Set(component);
    const memo = new Map<string, string[]>();
    function longestFrom(nodeId: string, visiting = new Set<string>()): string[] {
      const cached = memo.get(nodeId);
      if (cached) {
        return cached;
      }
      if (visiting.has(nodeId)) {
        return [nodeId];
      }
      const nextVisiting = new Set(visiting).add(nodeId);
      let bestTail: string[] = [];
      for (const next of outgoing.get(nodeId) ?? []) {
        if (!componentIds.has(next)) {
          continue;
        }
        const candidate = longestFrom(next, nextVisiting);
        if (candidate.length > bestTail.length) {
          bestTail = candidate;
        }
      }
      const result = [nodeId, ...bestTail];
      memo.set(nodeId, result);
      return result;
    }

    const sources = component.filter((id) => (incomingCount.get(id) ?? 0) === 0);
    const candidates = sources.length > 0 ? sources : component;
    return candidates
      .map((id) => longestFrom(id))
      .sort((left, right) => right.length - left.length)[0] ?? [];
  });
}

function alignPrimarySignalBuses(
  positions: Record<string, DiagramPosition>,
  nodes: Node<BlockNodeData>[],
  edges: Edge[],
): void {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const chain of primaryChains(nodes, edges)) {
    if (chain.length < 2) {
      continue;
    }
    const centers = chain.map((id) => {
      const node = nodeById.get(id);
      return (positions[id]?.y ?? 0) + (node ? nodeSize(node).height / 2 : 0);
    });
    const baseline = centers.reduce((total, value) => total + value, 0) / centers.length;
    for (const id of chain) {
      const node = nodeById.get(id);
      if (node && positions[id]) {
        positions[id].y = baseline - nodeSize(node).height / 2;
      }
    }
  }
}

/**
 * ELK places the forward signal graph. Feedback edges are intentionally left
 * out: their geometry is handled by dedicated lower lanes, preventing a loop
 * from distorting the readable left-to-right control chain.
 */
export async function layoutDiagram(
  nodes: Node<BlockNodeData>[],
  edges: Edge[],
): Promise<Record<string, { x: number; y: number }>> {
  const elk = await getElk();
  const graph = {
    id: "diagram-root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.padding": "[top=48,left=48,bottom=96,right=48]",
      "elk.spacing.nodeNode": "64",
      "elk.layered.spacing.nodeNodeBetweenLayers": "104",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
    },
    children: nodes.map((node) => {
      const size = nodeSize(node);
      return {
        id: node.id,
        ...size,
        layoutOptions: {
          "elk.portConstraints": "FIXED_ORDER",
        },
        ports: [
          ...node.data.inputPorts.map((port, index) => ({
            id: portId(node.id, "input", port),
            width: 8,
            height: 8,
            layoutOptions: {
              "elk.port.side": "WEST",
              "elk.port.index": String(index),
            },
          })),
          ...node.data.outputPorts.map((port, index) => ({
            id: portId(node.id, "output", port),
            width: 8,
            height: 8,
            layoutOptions: {
              "elk.port.side": "EAST",
              "elk.port.index": String(index),
            },
          })),
        ],
      };
    }),
    edges: edges
      .filter((edge) => edge.data?.kind !== "feedback")
      .map((edge) => ({
        id: edge.id,
        sources: [portId(edge.source, "output", edge.sourceHandle ?? "out")],
        targets: [portId(edge.target, "input", edge.targetHandle ?? "in")],
      })),
  };

  const result = await elk.layout(graph);
  const laidOut: Record<string, DiagramPosition> = Object.fromEntries(
    (result.children ?? []).map((node) => [
      node.id,
      { x: node.x ?? 0, y: node.y ?? 0 },
    ]),
  );
  alignPrimarySignalBuses(laidOut, nodes, edges);
  const values = Object.values(laidOut);
  const minX = values.length > 0 ? Math.min(...values.map((position) => position.x)) : 0;
  const minY = values.length > 0 ? Math.min(...values.map((position) => position.y)) : 0;

  return Object.fromEntries(
    Object.entries(laidOut).map(([id, position]) => [
      id,
      { x: position.x - minX + 80, y: position.y - minY + 80 },
    ]),
  );
}

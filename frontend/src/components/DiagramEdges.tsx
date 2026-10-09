import { BaseEdge, type EdgeProps, useReactFlow } from "reactflow";
import type { DiagramEdgeData } from "../features/edgeRouting";

interface Point {
  x: number;
  y: number;
}

const BRANCH_LEAD = 28;
const TARGET_LEAD = 28;
const FEEDBACK_CLEARANCE = 64;
const FEEDBACK_LANE_GAP = 28;
const FEEDBACK_VERTICAL_GAP = 16;

function distance(left: Point, right: Point): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function toward(from: Point, to: Point, amount: number): Point {
  const total = distance(from, to);
  if (total === 0) {
    return from;
  }
  const ratio = Math.min(1, amount / total);
  return {
    x: from.x + (to.x - from.x) * ratio,
    y: from.y + (to.y - from.y) * ratio,
  };
}

function roundedOrthogonalPath(points: Point[], radius = 4): string {
  const filtered = points.filter(
    (point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y,
  );
  if (filtered.length < 2) {
    return "";
  }

  let path = `M ${filtered[0].x} ${filtered[0].y}`;
  for (let index = 1; index < filtered.length - 1; index += 1) {
    const previous = filtered[index - 1];
    const corner = filtered[index];
    const next = filtered[index + 1];
    const effectiveRadius = Math.min(
      radius,
      distance(previous, corner) / 2,
      distance(corner, next) / 2,
    );
    const before = toward(corner, previous, effectiveRadius);
    const after = toward(corner, next, effectiveRadius);
    path += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`;
  }
  const last = filtered[filtered.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

function edgeData(data: EdgeProps["data"]): DiagramEdgeData {
  const raw = data && typeof data === "object" ? data as Partial<DiagramEdgeData> : {};
  return {
    ...raw,
    kind: raw.kind === "feedback" ? "feedback" : "signal",
    lane: typeof raw.lane === "number" ? raw.lane : 0,
    showJunction: raw.showJunction === true,
  };
}

/**
 * A point of light travelling along the signal after a successful run. It is
 * always rendered and shown only while the canvas has the `has-flow` class.
 */
function SignalSpark({ path, duration }: { path: string; duration: number }) {
  // A stable per-edge offset keeps the dots from moving in lockstep.
  const offset = (path.length % 17) / 17;
  return (
    <circle className="signal-spark" r={1.8}>
      <animateMotion dur={`${duration}s`} begin={`${(offset * duration).toFixed(2)}s`} repeatCount="indefinite" path={path} />
    </circle>
  );
}

function Junction({ x, y }: Point) {
  return <circle className="signal-junction" cx={x} cy={y} r={4.2} />;
}

export function SignalEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
  data,
  interactionWidth,
}: EdgeProps) {
  const route = edgeData(data);
  const isAligned = Math.abs(sourceY - targetY) <= 2;
  const midX = targetX - sourceX >= 64
    ? sourceX + (targetX - sourceX) / 2
    : Math.max(sourceX, targetX) + 42;
  const path = isAligned
    ? `M ${sourceX} ${sourceY} L ${targetX} ${sourceY}`
    : roundedOrthogonalPath([
        { x: sourceX, y: sourceY },
        { x: midX, y: sourceY },
        { x: midX, y: targetY },
        { x: targetX, y: targetY },
      ]);

  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth} />
      <SignalSpark path={path} duration={2.4} />
      {route.showJunction && <Junction x={sourceX + BRANCH_LEAD} y={sourceY} />}
    </>
  );
}

export function FeedbackEdge({
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
  data,
  interactionWidth,
}: EdgeProps) {
  const { getNodes } = useReactFlow();
  const route = edgeData(data);
  const nodes = getNodes();
  const sourceNode = nodes.find((node) => node.id === source);
  const targetNode = nodes.find((node) => node.id === target);
  const sourceBottom = sourceNode
    ? sourceNode.position.y + (sourceNode.height ?? 96)
    : sourceY;
  const targetBottom = targetNode
    ? targetNode.position.y + (targetNode.height ?? 96)
    : targetY;
  const laneY = Math.max(sourceBottom, targetBottom, sourceY, targetY)
    + FEEDBACK_CLEARANCE
    + route.lane * FEEDBACK_LANE_GAP;
  const branchX = sourceX + BRANCH_LEAD + route.lane * FEEDBACK_VERTICAL_GAP;
  const approachX = targetX - TARGET_LEAD - route.lane * FEEDBACK_VERTICAL_GAP;
  const path = roundedOrthogonalPath([
    { x: sourceX, y: sourceY },
    { x: branchX, y: sourceY },
    { x: branchX, y: laneY },
    { x: approachX, y: laneY },
    { x: approachX, y: targetY },
    { x: targetX, y: targetY },
  ]);

  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth} />
      <SignalSpark path={path} duration={3.6} />
      {route.showJunction && <Junction x={branchX} y={sourceY} />}
    </>
  );
}

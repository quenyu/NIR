import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  MiniMap,
  addEdge,
  type Connection,
  type DefaultEdgeOptions,
  type Edge,
  type Viewport,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useUpdateNodeInternals,
  useReactFlow,
} from "reactflow";
import {
  ApiError,
  createServerProject,
  getServerProject,
  simulateDiagram,
  updateServerProject,
  validateDiagram,
  type ServerProjectPayload,
} from "../api/client";
import {
  MAX_PROJECT_FILE_SIZE_BYTES,
  ProjectFileError,
  createDiagramProject,
  downloadDiagramProject,
  parseDiagramProjectJson,
} from "../features/diagramPersistence";
import { BlockPalette } from "../components/BlockPalette";
import {
  DiagnosticsPanel,
  type DiagnosticIssue as PanelDiagnosticIssue,
  type DiagnosticProgressItem,
  type DiagnosticProgressStatus,
  type DiagnosticResult,
  type DiagnosticsRunState,
  type DiagnosticsTab,
} from "../components/DiagnosticsPanel";
import { ParameterEditor } from "../components/ParameterEditor";
import { SimulationChart, type ScopeTab } from "../components/SimulationChart";
import { ServerProjectsModal } from "../components/ServerProjectsModal";
import { UiIcon } from "../components/UiIcon";
import {
  WorkspaceInspector,
  type InspectorView,
} from "../components/workspace/WorkspaceInspector";
import { WorkspaceChrome } from "../components/workspace/WorkspaceChrome";
import { WorkspaceRail } from "../components/workspace/WorkspaceRail";
import { FeedbackEdge, SignalEdge } from "../components/DiagramEdges";
import { BlockNode } from "../nodes/BlockNode";
import { layoutDiagram } from "../features/diagramLayout";
import {
  diagnoseDiagram,
  diagnoseFlowModel,
  type DiagnosticCode,
  type ModelDiagnosticIssue,
} from "../features/modelDiagnostics";
import { routeDiagramEdges } from "../features/edgeRouting";
import {
  blockedSumInputMessage,
  defaultPosition,
  diagnosticTitle,
  diagramFromFlow,
  edgesFromDiagram,
  freeNodePosition,
  normalizeNodePositions,
  positionsFromNodes,
  positionsFromSubsystemParameters,
  stabilityPresentation,
  toNode,
  type DiagramNode,
} from "../features/modelingWorkspace";
import { EXAMPLE_PRESETS, STARTER_PRESETS, type ExamplePreset } from "./examples";
import type { SimulationResponse } from "../types/api";
import {
  defaultParametersFor,
  inputPortsFor,
  isBlockType,
  outputPortsFor,
  subsystemDiagram,
  subsystemDisplayName,
  type BlockNodeData,
  type BlockType,
  type Diagram,
} from "../types/diagram";

const NODE_TYPES = { block: BlockNode };
const EDGE_TYPES = { signal: SignalEdge, feedback: FeedbackEdge };
interface HierarchyFrame {
  subsystemId: string;
  subsystemLabel: string;
  parentNodes: DiagramNode[];
  parentEdges: Edge[];
  parentNodeCounter: number;
  parentViewport: Viewport;
}
interface HierarchyLevel {
  nodes: DiagramNode[];
  edges: Edge[];
  viewport: Viewport;
  nodeCounter: number;
}

/**
 * Write the open level back into its parents up to `targetDepth`: each
 * Subsystem receives the child diagram and its layout, and parent edges to
 * interface ports that no longer exist are dropped.
 */
function foldHierarchy(stack: HierarchyFrame[], open: HierarchyLevel, targetDepth: number): HierarchyLevel {
  let child = open;
  for (let index = stack.length - 1; index >= targetDepth; index -= 1) {
    const frame = stack[index];
    const parentNodes = frame.parentNodes.map((parentNode) => {
      if (parentNode.id !== frame.subsystemId) {
        return parentNode;
      }
      const parameters = {
        ...parentNode.data.parameters,
        diagram: diagramFromFlow(child.nodes, child.edges),
        layout: { positions: positionsFromNodes(child.nodes), viewport: child.viewport },
      };
      return {
        ...parentNode,
        data: {
          ...parentNode.data,
          parameters,
          inputPorts: inputPortsFor("Subsystem", parameters),
          outputPorts: outputPortsFor("Subsystem", parameters),
        },
      };
    });
    const subsystemNode = parentNodes.find((node) => node.id === frame.subsystemId);
    const allowedInputs = new Set(subsystemNode?.data.inputPorts ?? []);
    const allowedOutputs = new Set(subsystemNode?.data.outputPorts ?? []);
    const parentEdges = frame.parentEdges.filter((edge) => {
      if (edge.target === frame.subsystemId && !allowedInputs.has(edge.targetHandle ?? "in")) return false;
      if (edge.source === frame.subsystemId && !allowedOutputs.has(edge.sourceHandle ?? "out")) return false;
      return true;
    });
    child = {
      nodes: parentNodes,
      edges: parentEdges,
      viewport: frame.parentViewport,
      nodeCounter: frame.parentNodeCounter,
    };
  }
  return child;
}

const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
  type: "signal",
};

function ModelingWorkspace() {
  const [nodes, setNodes, onNodesChange] = useNodesState<BlockNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [result, setResult] = useState<SimulationResponse | null>(null);
  const [previousResult, setPreviousResult] = useState<SimulationResponse | null>(null);
  // Last successful run of the current diagram; survives edits that clear `result`.
  const lastRunRef = useRef<SimulationResponse | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [info, setInfo] = useState<string>("");
  const [solver, setSolver] = useState<"rk4" | "solve_ivp">("solve_ivp");
  const [tEnd, setTEnd] = useState<number>(6);
  const [dt, setDt] = useState<number>(0.01);
  const [isBusy, setIsBusy] = useState(false);
  const [diagnosticsState, setDiagnosticsState] = useState<DiagnosticsRunState>("idle");
  const [diagnosticsTab, setDiagnosticsTab] = useState<DiagnosticsTab>("issues");
  const [diagnosticsIssues, setDiagnosticsIssues] = useState<ModelDiagnosticIssue[]>([]);
  const [diagnosticsProgress, setDiagnosticsProgress] = useState<DiagnosticProgressItem[]>([]);
  const [isDiagnosticsCollapsed, setIsDiagnosticsCollapsed] = useState(true);
  const [isArranging, setIsArranging] = useState(false);
  const [isParameterModalOpen, setIsParameterModalOpen] = useState(false);
  const [scopeHeightPx, setScopeHeightPx] = useState(400);
  const [isScopeOpen, setIsScopeOpen] = useState(false);
  const [scopeTab, setScopeTab] = useState<ScopeTab>("plot");
  const [isResizingScope, setIsResizingScope] = useState(false);
  const [inspectorView, setInspectorView] = useState<InspectorView>("simulation");
  const [isLibraryCollapsed, setIsLibraryCollapsed] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [nodeCounter, setNodeCounter] = useState(1);
  const [hierarchyStack, setHierarchyStack] = useState<HierarchyFrame[]>([]);
  const [isServerProjectsOpen, setIsServerProjectsOpen] = useState(false);
  const [serverProjectId, setServerProjectId] = useState<string | null>(null);
  const [serverProjectVersion, setServerProjectVersion] = useState<number | null>(null);
  const [serverProjectTitle, setServerProjectTitle] = useState<string>("");
  const modelingMainRef = useRef<HTMLElement | null>(null);
  const libraryPaneRef = useRef<HTMLElement | null>(null);
  const nodeClickTimerRef = useRef<number | null>(null);
  const initialExampleLoadedRef = useRef(false);
  const modelRevisionRef = useRef("");
  const { screenToFlowPosition, fitView, getViewport, setViewport, getNode, setCenter } =
    useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => () => {
    if (nodeClickTimerRef.current !== null) window.clearTimeout(nodeClickTimerRef.current);
  }, []);

  const modelingMainStyle = useMemo(
    () =>
      ({ ["--scope-height" as string]: `${scopeHeightPx}px` }) as CSSProperties,
    [scopeHeightPx],
  );

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId)?.data ?? null,
    [nodes, selectedNodeId],
  );

  const hierarchyPath = useMemo(
    () => [
      { depth: 0, label: "Главная схема" },
      ...hierarchyStack.map((frame, index) => ({
        depth: index + 1,
        label: frame.subsystemLabel,
      })),
    ],
    [hierarchyStack],
  );

  const hiddenHierarchyParts = useMemo(
    () => (hierarchyPath.length > 4 ? hierarchyPath.slice(1, -2) : []),
    [hierarchyPath],
  );

  const visibleHierarchyParts = useMemo(
    () => (hierarchyPath.length > 4 ? [hierarchyPath[0], ...hierarchyPath.slice(-2)] : hierarchyPath),
    [hierarchyPath],
  );

  const currentLevelTitle =
    hierarchyStack[hierarchyStack.length - 1]?.subsystemLabel ?? "Главная схема";

  const selectedNodeTitle = selectedNode
    ? selectedNode.blockType === "Subsystem"
      ? subsystemDisplayName(selectedNode.parameters, selectedNode.blockId)
      : selectedNode.blockId
    : "";

  const selectedConnectedInputPorts = useMemo(() => {
    if (!selectedNodeId) {
      return [];
    }
    return edges
      .filter((edge) => edge.target === selectedNodeId)
      .map((edge) => edge.targetHandle ?? "in");
  }, [edges, selectedNodeId]);

  const nodePositions = useMemo(
    () => positionsFromNodes(nodes as DiagramNode[]),
    [nodes],
  );

  const edgeTopologyKey = useMemo(
    () => edges
      .map((edge) => `${edge.id}:${edge.source}:${edge.sourceHandle ?? "out"}:${edge.target}:${edge.targetHandle ?? "in"}`)
      .join("|"),
    [edges],
  );

  const modelRevisionKey = useMemo(
    () => JSON.stringify({
      nodes: nodes.map((node) => ({
        id: node.id,
        type: node.data.blockType,
        parameters: node.data.parameters,
        inputPorts: node.data.inputPorts,
        outputPorts: node.data.outputPorts,
      })),
      edges: edges.map((edge) => ({
        source: edge.source,
        sourceHandle: edge.sourceHandle ?? "out",
        target: edge.target,
        targetHandle: edge.targetHandle ?? "in",
      })),
    }),
    [edges, nodes],
  );

  const visibleNodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);

  const panelIssues = useMemo<PanelDiagnosticIssue[]>(() => {
    const mapped = diagnosticsIssues.map<PanelDiagnosticIssue>((issue) => {
      const visibleBlockId = issue.scopePath.find((id) => visibleNodeIds.has(id))
        ?? issue.nodeIds?.find((id) => visibleNodeIds.has(id))
        ?? (issue.nodeId && visibleNodeIds.has(issue.nodeId) ? issue.nodeId : undefined);
      const path = [...issue.scopePath, issue.nodeId].filter(Boolean).join(" / ");
      return {
        id: issue.id,
        severity: issue.severity,
        title: diagnosticTitle(issue),
        message: issue.message,
        blockId: visibleBlockId,
        blockLabel: path || undefined,
      };
    });
    const knownMessages = new Set(diagnosticsIssues.map((issue) => issue.message));
    errors.forEach((message, index) => {
      if (!knownMessages.has(message)) {
        mapped.push({
          id: `operation-error-${index}`,
          severity: "error",
          title: "Ошибка операции",
          message,
        });
      }
    });
    return mapped;
  }, [diagnosticsIssues, errors, visibleNodeIds]);

  const diagnosticSeverityByNode = useMemo(() => {
    const rank = { info: 0, warning: 1, error: 2 } as const;
    const resultByNode = new Map<string, "warning" | "error">();
    diagnosticsIssues.forEach((issue) => {
      const severity = issue.severity;
      if (severity === "info") {
        return;
      }
      const candidates = [
        ...issue.scopePath,
        ...(issue.nodeIds ?? []),
        ...(issue.nodeId ? [issue.nodeId] : []),
      ];
      candidates.forEach((nodeId) => {
        if (!visibleNodeIds.has(nodeId)) {
          return;
        }
        const current = resultByNode.get(nodeId);
        if (!current || rank[severity] > rank[current]) {
          resultByNode.set(nodeId, severity);
        }
      });
    });
    return resultByNode;
  }, [diagnosticsIssues, visibleNodeIds]);

  const renderedNodes = useMemo(
    () => nodes.map((node) => {
      const severity = diagnosticSeverityByNode.get(node.id);
      return {
        ...node,
        className: [node.className, severity ? `has-diagnostic-${severity}` : undefined]
          .filter(Boolean)
          .join(" "),
      };
    }),
    [diagnosticSeverityByNode, nodes],
  );

  const diagnosticResults = useMemo<DiagnosticResult[]>(() => {
    if (!result?.success) {
      return [];
    }
    const stability = stabilityPresentation(result.system_analysis?.stability);
    return [
      { id: "signals", label: "Сигналы", value: Object.keys(result.outputs ?? {}).length },
      { id: "points", label: "Точек расчёта", value: result.time?.length ?? 0 },
      { id: "states", label: "Размерность x", value: result.system_analysis?.state_dimension ?? "—" },
      { id: "stability", label: "Устойчивость", value: stability.label, tone: stability.tone },
    ];
  }, [result]);

  const effectiveDiagnosticsState: DiagnosticsRunState =
    diagnosticsState === "idle" && errors.length > 0 ? "error" : diagnosticsState;

  const runButtonLabel = diagnosticsState === "validating"
    ? "Проверяю схему"
    : diagnosticsState === "running"
      ? "Выполняется расчёт"
      : diagnosticsState === "error"
        ? "Проверить снова"
        : result?.success
          ? "Запустить снова"
          : "Запустить модель";

  useEffect(() => {
    if (initialExampleLoadedRef.current || typeof window === "undefined") {
      return;
    }
    initialExampleLoadedRef.current = true;
    const exampleId = new URLSearchParams(window.location.search).get("example");
    const preset = EXAMPLE_PRESETS.find((candidate) => candidate.id === exampleId);
    if (preset) {
      applyPreset(preset);
    }
    // Runs once on mount: ?example=<id> opens a preset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setEdges((current) =>
      routeDiagramEdges(current, nodePositions),
    );
  }, [edgeTopologyKey, nodePositions, setEdges]);

  useEffect(() => {
    const previousRevision = modelRevisionRef.current;
    modelRevisionRef.current = modelRevisionKey;
    if (!previousRevision || previousRevision === modelRevisionKey) {
      return;
    }
    if (
      diagnosticsState !== "idle" ||
      diagnosticsIssues.length > 0 ||
      errors.length > 0 ||
      result
    ) {
      setDiagnosticsState("idle");
      setDiagnosticsIssues([]);
      setDiagnosticsProgress([]);
      setDiagnosticsTab("issues");
      setIsDiagnosticsCollapsed(true);
      setResult(null);
      setErrors([]);
      setIsScopeOpen(false);
      setScopeTab("plot");
    }
  }, [diagnosticsIssues.length, diagnosticsState, errors.length, modelRevisionKey, result]);

  useEffect(() => {
    function onKeydown(event: KeyboardEvent) {
      if (event.key !== "Delete" || !selectedNodeId) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      setNodes((current) =>
        current.filter((node) => node.id !== selectedNodeId),
      );
      setEdges((current) =>
        current.filter(
          (edge) =>
            edge.source !== selectedNodeId && edge.target !== selectedNodeId,
        ),
      );
      setSelectedNodeId(null);
      setInspectorView("simulation");
      setIsInspectorOpen(false);
      setIsParameterModalOpen(false);
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [selectedNodeId, setEdges, setNodes]);

  useEffect(() => {
    if (!isResizingScope) {
      return;
    }

    function clampScopeHeight(value: number, containerHeight: number): number {
      const minScope = 280;
      const minCanvas = 240;
      const splitter = 14;
      const maxScope = Math.max(
        minScope,
        containerHeight - minCanvas - splitter,
      );
      return Math.min(maxScope, Math.max(minScope, value));
    }

    function onMouseMove(event: MouseEvent) {
      const container = modelingMainRef.current;
      if (!container) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const desired = rect.bottom - event.clientY;
      setScopeHeightPx(clampScopeHeight(desired, rect.height));
    }

    function stopResize() {
      setIsResizingScope(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", stopResize);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", stopResize);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizingScope]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    // Plotly resizes reliably on window resize events.
    window.dispatchEvent(new Event("resize"));
  }, [scopeHeightPx, isResizingScope]);

  useEffect(() => {
    if (result?.success || errors.length > 0) {
      setIsScopeOpen(true);
    }
  }, [errors.length, result?.success]);

  function startScopeResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsResizingScope(true);
  }


  function addBlock(type: BlockType, position?: { x: number; y: number }) {
    let counter = nodeCounter;
    let id = `${type}-${counter}`;
    const existingIds = new Set(nodes.map((node) => node.id));
    while (existingIds.has(id)) {
      counter += 1;
      id = `${type}-${counter}`;
    }
    setNodeCounter(counter + 1);
    const parameters = defaultParametersFor(type);
    if (type === "SubsystemInput" || type === "SubsystemOutput") {
      const prefix = type === "SubsystemInput" ? "in" : "out";
      const usedPorts = new Set(
        nodes
          .filter((node) => node.data.blockType === type)
          .map((node) => String(node.data.parameters.port ?? "")),
      );
      let portIndex = 1;
      let portName = prefix;
      while (usedPorts.has(portName)) {
        portIndex += 1;
        portName = `${prefix}${portIndex}`;
      }
      parameters.port = portName;
    }
    const inputPorts = inputPortsFor(type, parameters);
    const outputPorts = outputPortsFor(type, parameters);
    const data: BlockNodeData = {
      blockId: id,
      blockType: type,
      parameters,
      inputPorts,
      outputPorts,
    };
    const sourcePosition = position ?? defaultPosition(nodes.length);
    const requestedPosition = {
      x: Math.round(sourcePosition.x / 8) * 8,
      y: Math.round(sourcePosition.y / 8) * 8,
    };
    const node: DiagramNode = {
      id,
      type: "block",
      position: freeNodePosition(nodes as DiagramNode[], requestedPosition, data),
      data,
    };
    setNodes((current) => [...current, node]);
  }

  function applyPreset(preset: ExamplePreset) {
    const loadedNodes = normalizeNodePositions(
      preset.diagram.blocks.map((block, index) =>
        toNode(block, preset.positions[block.id] ?? defaultPosition(index)),
      ),
    );
    const positions = positionsFromNodes(loadedNodes);
    setNodes(loadedNodes);
    setEdges(edgesFromDiagram(preset.diagram, positions));
    setNodeCounter(loadedNodes.length + 1);
    setSelectedNodeId(null);
    setInspectorView("simulation");
    setIsInspectorOpen(false);
    setIsLibraryCollapsed(true);
    setErrors([]);
    setInfo(`Загружен пример: ${preset.title}`);
    setResult(null);
    setIsScopeOpen(false);
    setScopeTab("plot");
    setHierarchyStack([]);
    setPreviousResult(null);
    lastRunRef.current = null;
    setServerProjectId(null);
    setServerProjectVersion(null);
    setServerProjectTitle("");
    libraryPaneRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => {
      void fitView({ padding: 0.1, duration: 250, maxZoom: 1 });
    }, 0);
  }

  function onConnect(connection: Connection) {
    if (!connection.source || !connection.target) {
      return;
    }
    const targetHandle = connection.targetHandle ?? "in";
    const occupied = edges.some(
      (edge) =>
        edge.target === connection.target &&
        (edge.targetHandle ?? "in") === targetHandle,
    );
    if (occupied) {
      setErrors([
        `Вход ${connection.target}.${targetHandle} уже имеет связь. Один вход может иметь только один источник.`,
      ]);
      setInfo("");
      return;
    }
    const edge: Edge = {
      ...connection,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? "out",
      targetHandle,
      id: `edge-${connection.source}-${connection.target}-${Date.now()}`,
    };
    setEdges((current) =>
      routeDiagramEdges(addEdge(edge, current), nodePositions),
    );
  }

  async function arrangeCurrentDiagram() {
    if (nodes.length < 2) {
      setInfo("Для упорядочивания добавьте минимум два блока.");
      return;
    }

    setIsArranging(true);
    setErrors([]);
    try {
      const routedEdges = routeDiagramEdges(edges, nodePositions);
      const positions = await layoutDiagram(nodes as DiagramNode[], routedEdges);
      setNodes((current) => current.map((node) => ({
        ...node,
        position: positions[node.id] ?? node.position,
      })));
      setEdges((current) => routeDiagramEdges(current, positions));
      setInfo("Схема упорядочена: основной сигнал слева направо, обратные связи — по нижним полосам.");
      window.requestAnimationFrame(() => {
        nodes.forEach((node) => updateNodeInternals(node.id));
        window.requestAnimationFrame(() => {
          void fitView({ padding: 0.1, duration: 300, maxZoom: 1 });
        });
      });
    } catch (layoutError) {
      setErrors([
        layoutError instanceof Error
          ? `Не удалось упорядочить схему: ${layoutError.message}`
          : "Не удалось упорядочить схему.",
      ]);
    } finally {
      setIsArranging(false);
    }
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const droppedType = event.dataTransfer.getData(
      "application/nir-block-type",
    );
    if (!isBlockType(droppedType)) {
      return;
    }
    const position = screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });
    addBlock(droppedType, position);
  }

  function applySelectedParameters(updates: Record<string, unknown>) {
    const selectedId = selectedNodeId;
    if (!selectedId) {
      return;
    }

    const node = nodes.find((currentNode) => currentNode.id === selectedId);
    if (!node) {
      return;
    }

    const nextParameters = { ...node.data.parameters, ...updates };
    const nextInputPorts = inputPortsFor(node.data.blockType, nextParameters);
    const nextOutputPorts = outputPortsFor(node.data.blockType, nextParameters);
    const blockedInputEdge = edges.find(
      (edge) =>
        edge.target === selectedId &&
        !nextInputPorts.includes(edge.targetHandle ?? "in"),
    );

    if (node.data.blockType === "Sum" && blockedInputEdge?.targetHandle) {
      setErrors([blockedSumInputMessage(blockedInputEdge.targetHandle)]);
      setInfo("");
      return;
    }

    const inputCountChanged =
      node.data.inputPorts.length !== nextInputPorts.length;

    setNodes((current) =>
      current.map((currentNode) => {
        if (currentNode.id !== selectedId) {
          return currentNode;
        }
        return {
          ...currentNode,
          data: {
            ...currentNode.data,
            parameters: nextParameters,
            inputPorts: nextInputPorts,
            outputPorts: nextOutputPorts,
          },
        };
      }),
    );

    setEdges((current) => {
      const allowedInputs = new Set(nextInputPorts);
      const allowedOutputs = new Set(nextOutputPorts);
      return current.filter((edge) => {
        if (
          edge.target === selectedId &&
          !allowedInputs.has(edge.targetHandle ?? "in")
        ) {
          return false;
        }
        if (
          edge.source === selectedId &&
          !allowedOutputs.has(edge.sourceHandle ?? "out")
        ) {
          return false;
        }
        return true;
      });
    });

    if ((node.data.blockType === "Sum" || node.data.blockType === "Subsystem") && inputCountChanged) {
      window.setTimeout(() => updateNodeInternals(selectedId), 0);
    }
  }

  function openLevel(): HierarchyLevel {
    return { nodes: nodes as DiagramNode[], edges, viewport: getViewport(), nodeCounter };
  }

  /** The complete root diagram, including unsaved edits of the open level. */
  function rootLevel(): HierarchyLevel {
    return foldHierarchy(hierarchyStack, openLevel(), 0);
  }

  function diagramWithCurrentHierarchy(): Diagram {
    const root = rootLevel();
    return diagramFromFlow(root.nodes, root.edges);
  }

  function enterSubsystem(nodeId: string) {
    const subsystemNode = nodes.find((node) => node.id === nodeId);
    if (!subsystemNode || subsystemNode.data.blockType !== "Subsystem") {
      return;
    }
    const nested = subsystemDiagram(subsystemNode.data.parameters);
    if (!nested) {
      setErrors([`Подсистема ${nodeId} не содержит корректной вложенной схемы.`]);
      return;
    }
    const positions = positionsFromSubsystemParameters(subsystemNode.data.parameters, nested);
    setHierarchyStack((current) => [
      ...current,
      {
        subsystemId: nodeId,
        subsystemLabel: subsystemDisplayName(subsystemNode.data.parameters, nodeId),
        parentNodes: nodes as DiagramNode[],
        parentEdges: edges,
        parentNodeCounter: nodeCounter,
        parentViewport: getViewport(),
      },
    ]);
    const nestedNodes = normalizeNodePositions(
      nested.blocks.map((block, index) => toNode(block, positions[block.id] ?? defaultPosition(index))),
    );
    const normalizedPositions = positionsFromNodes(nestedNodes);
    setNodes(nestedNodes);
    setEdges(edgesFromDiagram(nested, normalizedPositions));
    setNodeCounter(nextCounterForDiagram(nested));
    setSelectedNodeId(null);
    setInspectorView("simulation");
    setIsInspectorOpen(false);
    setIsParameterModalOpen(false);
    setResult(null);
    setIsScopeOpen(false);
    setDiagnosticsState("idle");
    setDiagnosticsIssues([]);
    setDiagnosticsProgress([]);
    setDiagnosticsTab("issues");
    setIsDiagnosticsCollapsed(true);
    setErrors([]);
    setInfo(`Открыта подсистема ${nodeId}.`);
    window.setTimeout(() => void fitView({ padding: 0.1, duration: 250, maxZoom: 1 }), 0);
  }

  function leaveSubsystemToDepth(targetDepth: number) {
    if (
      targetDepth < 0 ||
      targetDepth >= hierarchyStack.length ||
      hierarchyStack.length === 0
    ) {
      return;
    }

    const parent = foldHierarchy(hierarchyStack, openLevel(), targetDepth);

    const selectedSubsystemId = hierarchyStack[targetDepth].subsystemId;
    setHierarchyStack((current) => current.slice(0, targetDepth));
    setNodes(parent.nodes);
    setEdges(parent.edges);
    setNodeCounter(parent.nodeCounter);
    setSelectedNodeId(selectedSubsystemId);
    setInspectorView("block");
    setIsInspectorOpen(true);
    setResult(null);
    setIsScopeOpen(false);
    setErrors([]);
    setInfo(`Изменения уровня сохранены. Открыт уровень ${targetDepth}.`);
    window.setTimeout(() => {
      void setViewport(parent.viewport, { duration: 180 });
      updateNodeInternals(selectedSubsystemId);
    }, 0);
  }

  function leaveSubsystem() {
    leaveSubsystemToDepth(hierarchyStack.length - 1);
  }

  function nextCounterForDiagram(diagram: Diagram): number {
    let maximum = 0;
    for (const block of diagram.blocks) {
      const match = block.id.match(/(\d+)$/);
      if (match) {
        maximum = Math.max(maximum, Number(match[1]));
      }
    }
    return Math.max(diagram.blocks.length + 1, maximum + 1);
  }

  function saveProjectToJson() {
    if (nodes.length === 0) {
      setInfo("");
      setErrors(["Добавьте хотя бы один блок перед сохранением проекта."]);
      return;
    }

    const root = rootLevel();
    const project = createDiagramProject({
      diagram: diagramFromFlow(root.nodes, root.edges),
      positions: positionsFromNodes(root.nodes),
      viewport: root.viewport,
      simulation: {
        solver,
        t_start: 0,
        t_end: tEnd,
        dt,
      },
    });
    downloadDiagramProject(project);
    setErrors([]);
    setInfo("Проект сохранён в JSON-файл.");
  }

  function currentServerPayload(): ServerProjectPayload {
    const root = rootLevel();
    return {
      diagram: diagramFromFlow(root.nodes, root.edges),
      layout: {
        positions: positionsFromNodes(root.nodes),
        viewport: root.viewport,
      },
      simulation: {
        solver,
        t_start: 0,
        t_end: tEnd,
        dt,
      },
    };
  }

  async function createProjectOnServer(title: string) {
    setIsBusy(true);
    setErrors([]);
    try {
      const record = await createServerProject(title, currentServerPayload());
      setServerProjectId(record.id);
      setServerProjectVersion(record.version);
      setServerProjectTitle(record.title);
      setInfo(`Проект «${record.title}» сохранён на сервере, версия ${record.version}.`);
    } finally {
      setIsBusy(false);
    }
  }

  async function saveCurrentProjectOnServer() {
    if (!serverProjectId || serverProjectVersion === null) {
      setIsServerProjectsOpen(true);
      return;
    }
    setIsBusy(true);
    setErrors([]);
    try {
      const record = await updateServerProject(
        serverProjectId,
        serverProjectTitle,
        currentServerPayload(),
        serverProjectVersion,
      );
      setServerProjectVersion(record.version);
      setInfo(`Серверный проект обновлён до версии ${record.version}.`);
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.status === 409) {
        const serverVersion = saveError.payload.current_version;
        setErrors([
          `Проект изменён в другой сессии (на сервере версия ${String(serverVersion)}). `
          + "Откройте актуальную версию или сохраните текущую схему как новый проект.",
        ]);
        setIsServerProjectsOpen(true);
      } else {
        setErrors(saveError instanceof ApiError ? saveError.messages : ["Не удалось сохранить проект на сервере."]);
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function openProjectFromServer(projectId: string) {
    setIsBusy(true);
    setErrors([]);
    try {
      const record = await getServerProject(projectId);
      const { diagram, layout, simulation } = record.payload;
      const loadedNodes = normalizeNodePositions(
        diagram.blocks.map((block, index) => toNode(block, layout.positions[block.id] ?? defaultPosition(index))),
      );
      const positions = positionsFromNodes(loadedNodes);
      setNodes(loadedNodes);
      setEdges(edgesFromDiagram(diagram, positions));
      setNodeCounter(nextCounterForDiagram(diagram));
      setHierarchyStack([]);
      setPreviousResult(null);
      lastRunRef.current = null;
    lastRunRef.current = null;
    setPreviousResult(null);
    lastRunRef.current = null;
      setSelectedNodeId(null);
      setInspectorView("simulation");
      setIsInspectorOpen(false);
      setResult(null);
      setIsScopeOpen(false);
      setScopeTab("plot");
      setSolver(simulation.solver);
      setTEnd(simulation.t_end);
      setDt(simulation.dt);
      setServerProjectId(record.id);
      setServerProjectVersion(record.version);
      setServerProjectTitle(record.title);
      setIsServerProjectsOpen(false);
      setInfo(`Открыт серверный проект «${record.title}», версия ${record.version}.`);
      window.setTimeout(() => {
        if (layout.viewport) void setViewport(layout.viewport, { duration: 200 });
        else void fitView({ padding: 0.1, duration: 250, maxZoom: 1 });
      }, 0);
    } catch (openError) {
      setErrors(openError instanceof ApiError ? openError.messages : ["Не удалось открыть серверный проект."]);
    } finally {
      setIsBusy(false);
    }
  }

  async function loadProjectFromJson(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) {
      return;
    }

    if (file.size > MAX_PROJECT_FILE_SIZE_BYTES) {
      setInfo("");
      setErrors(["Файл слишком большой. Максимальный размер проекта — 5 МБ."]);
      return;
    }

    setIsBusy(true);
    setInfo("");
    setErrors([]);
    try {
      const parsed = parseDiagramProjectJson(await file.text());
      const { project, warnings } = parsed;
      const loadedNodes = normalizeNodePositions(
        project.diagram.blocks.map((block, index) =>
          toNode(
            block,
            project.layout.positions[block.id] ?? defaultPosition(index),
          ),
        ),
      );
      const positions = positionsFromNodes(loadedNodes);

      setNodes(loadedNodes);
      setEdges(edgesFromDiagram(project.diagram, positions));
      setNodeCounter(nextCounterForDiagram(project.diagram));
      setSolver(project.simulation.solver);
      setTEnd(project.simulation.t_end);
      setDt(project.simulation.dt);
      setSelectedNodeId(null);
      setInspectorView("simulation");
      setIsInspectorOpen(false);
      setIsParameterModalOpen(false);
      setResult(null);
      setIsScopeOpen(false);
      setScopeTab("plot");
      setHierarchyStack([]);
      setPreviousResult(null);
      lastRunRef.current = null;
    lastRunRef.current = null;
    setPreviousResult(null);
    lastRunRef.current = null;
      setServerProjectId(null);
      setServerProjectVersion(null);
      setServerProjectTitle("");
      setErrors([]);
      setInfo(
        warnings.length > 0
          ? `Проект «${project.metadata.title}» загружен. ${warnings.join(" ")}`
          : `Проект «${project.metadata.title}» загружен из ${file.name}.`,
      );

      window.setTimeout(() => {
        if (project.layout.viewport) {
          void setViewport(project.layout.viewport, { duration: 200 });
        } else {
          void fitView({ padding: 0.1, duration: 250, maxZoom: 1 });
        }
      }, 0);
    } catch (error) {
      if (error instanceof ProjectFileError) {
        setErrors([error.message, ...error.details]);
      } else {
        setErrors([
          error instanceof Error
            ? error.message
            : "Не удалось загрузить проект.",
        ]);
      }
      setDiagnosticsTab("issues");
      setIsScopeOpen(true);
      setIsDiagnosticsCollapsed(false);
    } finally {
      setIsBusy(false);
    }
  }

  function focusDiagnosticIssue(issue: PanelDiagnosticIssue) {
    if (!issue.blockId) {
      return;
    }
    const node = getNode(issue.blockId);
    if (!node) {
      return;
    }
    setSelectedNodeId(issue.blockId);
    setInspectorView("block");
    setIsInspectorOpen(true);
    setIsLibraryCollapsed(true);
    setNodes((current) => current.map((candidate) => ({
      ...candidate,
      selected: candidate.id === issue.blockId,
    })));
    const origin = node.positionAbsolute ?? node.position;
    const centerX = origin.x + (node.width ?? 180) / 2;
    const centerY = origin.y + (node.height ?? 76) / 2;
    void setCenter(centerX, centerY, {
      zoom: Math.min(Math.max(getViewport().zoom, 0.85), 1.05),
      duration: 320,
    });
  }

  function runPreflight(diagram: Diagram) {
    const report = hierarchyStack.length === 0
      ? diagnoseFlowModel(nodes as DiagramNode[], edges)
      : diagnoseDiagram(diagram);
    setDiagnosticsIssues(report.issues);
    setErrors(
      report.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.message),
    );
    return report;
  }

  function showRunProgress(structure: StepStatus, server: StepStatus, serverLabel: string) {
    setDiagnosticsProgress([
      { id: "structure", label: "Проверка структуры", status: structure[0], detail: structure[1] },
      { id: "server", label: serverLabel, status: server[0], detail: server[1] },
    ]);
  }

  function reportFailure(error: unknown, idPrefix: string) {
    const apiError = error instanceof ApiError ? error : null;
    const messages = apiError?.messages ?? [error instanceof Error ? error.message : "Неизвестная ошибка."];
    const code: DiagnosticCode = !apiError
      ? "server-error"
      : apiError.code === "server_unreachable"
        ? "server-unreachable"
        : apiError.code === "diagram_invalid"
          ? "model-rejected"
          : apiError.code === "solver_settings" || apiError.code === "solver_failed"
            ? "solver-error"
            : apiError.code === "request_invalid" ? "settings-invalid" : "server-error";
    setErrors(messages);
    setDiagnosticsIssues((current) => [
      ...current.filter((issue) => issue.code !== "model-ready"),
      ...messages.map((message, index): ModelDiagnosticIssue => ({
        id: `${idPrefix}-${index}`, code, severity: "error", message, scopePath: [],
      })),
    ]);
    setDiagnosticsState("error");
    setDiagnosticsTab("issues");
    setIsDiagnosticsCollapsed(false);
  }

  function openDiagnosticsDock() {
    setScopeHeightPx((current) => Math.min(current, 280));
    setIsScopeOpen(true);
    setIsDiagnosticsCollapsed(false);
  }

  async function runValidation() {
    const serverLabel = "Сборка модели на сервере";
    setIsLibraryCollapsed(true);
    setIsInspectorOpen(false);
    setInfo("");
    setResult(null);
    setDiagnosticsState("validating");
    setDiagnosticsTab("progress");
    showRunProgress(["active", "Соединения и обязательные порты"], ["pending"], serverLabel);
    openDiagnosticsDock();
    const diagram = diagramWithCurrentHierarchy();
    if (!runPreflight(diagram).canRun) {
      setDiagnosticsState("error");
      setDiagnosticsTab("issues");
      showRunProgress(["error", "Найдены ошибки"], ["pending"], serverLabel);
      return;
    }
    showRunProgress(["done"], ["active", "Иерархия, петли, матрицы A, B, C, D"], serverLabel);
    try {
      const response = await validateDiagram(diagram);
      if (!response.valid) {
        throw new ApiError("Схема содержит ошибки.", 422, "diagram_invalid", response.errors);
      }
      setErrors([]);
      setDiagnosticsState("success");
      setDiagnosticsTab("issues");
      showRunProgress(["done"], ["done", "Модель готова к расчёту"], serverLabel);
      setInfo("Схема корректна: сервер собрал единую модель.");
    } catch (error) {
      reportFailure(error, "validation-error");
      showRunProgress(["done"], ["error", "Сервер отклонил схему"], serverLabel);
    }
  }

  async function runSimulation() {
    const serverLabel = "Сборка модели и расчёт";
    setScopeTab("plot");
    setIsLibraryCollapsed(true);
    setIsInspectorOpen(false);
    setInfo("");
    setErrors([]);
    setResult(null);
    setInspectorView("simulation");
    openDiagnosticsDock();
    if (dt <= 0 || tEnd <= 0) {
      setDiagnosticsIssues([{
        id: "simulation-range",
        code: "settings-invalid",
        severity: "error",
        message: "Параметры моделирования должны удовлетворять условиям: t_end > 0 и dt > 0.",
        scopePath: [],
      }]);
      setErrors(["Параметры моделирования должны удовлетворять условиям: t_end > 0 и dt > 0."]);
      setDiagnosticsState("error");
      setDiagnosticsTab("issues");
      showRunProgress(["pending"], ["error", "Проверьте t_end и dt"], serverLabel);
      return;
    }

    setDiagnosticsState("validating");
    setDiagnosticsTab("progress");
    showRunProgress(["active", "Соединения и параметры блоков"], ["pending"], serverLabel);
    const diagram = diagramWithCurrentHierarchy();
    if (!runPreflight(diagram).canRun) {
      setDiagnosticsState("error");
      setDiagnosticsTab("issues");
      showRunProgress(["error", "Исправьте отмеченные блоки"], ["pending"], serverLabel);
      return;
    }

    setDiagnosticsState("running");
    showRunProgress(["done"], ["active", solver === "solve_ivp" ? "Адаптивный RK45" : "RK4 с постоянным шагом"], serverLabel);
    setIsBusy(true);
    try {
      const response = await simulateDiagram({ diagram, t_start: 0, t_end: tEnd, dt, solver });
      setPreviousResult(lastRunRef.current);
      lastRunRef.current = response;
      setResult(response);
      setDiagnosticsState("success");
      setDiagnosticsTab("results");
      showRunProgress(["done"], ["done", `${response.time.length} точек`], serverLabel);
      setScopeHeightPx((current) => Math.max(current, 400));
      setIsDiagnosticsCollapsed(true);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          void fitView({ padding: 0.1, duration: 220, maxZoom: 1 });
        });
      });
    } catch (error) {
      setResult(null);
      reportFailure(error, "simulation-error");
      showRunProgress(["done"], ["error", "Расчёт остановлен"], serverLabel);
    } finally {
      setIsBusy(false);
    }
  }

  function clearDiagram() {
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    setInspectorView("simulation");
    setIsInspectorOpen(false);
    setResult(null);
    setIsScopeOpen(false);
    setScopeTab("plot");
    setErrors([]);
    setInfo("");
    setIsParameterModalOpen(false);
    setHierarchyStack([]);
    setPreviousResult(null);
    lastRunRef.current = null;
    setServerProjectId(null);
    setServerProjectVersion(null);
    setServerProjectTitle("");
  }

  function deleteSelectedNode() {
    if (!selectedNodeId) {
      return;
    }
    setNodes((current) => current.filter((node) => node.id !== selectedNodeId));
    setEdges((current) =>
      current.filter(
        (edge) =>
          edge.source !== selectedNodeId && edge.target !== selectedNodeId,
      ),
    );
    setSelectedNodeId(null);
    setInspectorView("simulation");
    setIsInspectorOpen(false);
    setIsParameterModalOpen(false);
  }

  return (
    <main className={`control-app ${effectiveDiagnosticsState === "running" ? "is-running" : ""}`}>
      <a className="skip-link" href="#diagram-workbench">К рабочей схеме</a>
      <WorkspaceChrome
        diagnosticsState={effectiveDiagnosticsState}
        simulationSucceeded={Boolean(result?.success)}
        runDisabled={isBusy || diagnosticsState === "validating" || diagnosticsState === "running"}
        runButtonLabel={runButtonLabel}
        onRun={runSimulation}
        onSaveProject={saveProjectToJson}
        onImportProject={loadProjectFromJson}
        isArranging={isArranging}
        canArrange={nodes.length >= 2}
        onArrange={() => void arrangeCurrentDiagram()}
        projectTitle={serverProjectTitle}
        nodeCount={nodes.length}
        edgeCount={edges.length}
        serverProjectId={serverProjectId}
        serverProjectVersion={serverProjectVersion}
        onSaveServerProject={() => void saveCurrentProjectOnServer()}
        onOpenServerProjects={() => setIsServerProjectsOpen(true)}
        onClear={clearDiagram}
      />
      <section className={`workspace ${isLibraryCollapsed ? "library-collapsed" : "library-open"} ${isInspectorOpen ? "inspector-open" : ""}`}>
        <WorkspaceRail
          diagnosticsState={effectiveDiagnosticsState}
          simulationSucceeded={Boolean(result?.success)}
          isLibraryOpen={!isLibraryCollapsed}
          isInspectorOpen={isInspectorOpen}
          isScopeOpen={isScopeOpen}
          isArranging={isArranging}
          canArrange={nodes.length >= 2}
          onToggleLibrary={() => {
            setIsLibraryCollapsed((current) => !current);
            setIsInspectorOpen(false);
          }}
          onOpenInspector={() => {
            setInspectorView("simulation");
            setIsInspectorOpen(true);
            setIsLibraryCollapsed(true);
          }}
          onToggleScope={() => {
            if (isScopeOpen) {
              setScopeTab("plot");
            }
            setIsScopeOpen((current) => !current);
          }}
          onArrange={() => void arrangeCurrentDiagram()}
          onFit={() => void fitView({ padding: 0.08, duration: 280, maxZoom: 1 })}
        />
        {(!isLibraryCollapsed || isInspectorOpen) && (
          <button
            type="button"
            className="workspace-panel-scrim"
            aria-label="Закрыть боковую панель"
            onClick={() => {
              setIsLibraryCollapsed(true);
              setIsInspectorOpen(false);
            }}
          />
        )}
        <aside
          ref={libraryPaneRef}
          className={`library-pane ${isLibraryCollapsed ? "is-collapsed" : "is-open"}`}
          aria-hidden={isLibraryCollapsed}
          data-testid="block-library-pane"
        >
          <button
            type="button"
            className="library-pane__toggle"
            onClick={() => setIsLibraryCollapsed(true)}
            aria-expanded={!isLibraryCollapsed}
            title="Закрыть библиотеку"
          >
            <span>Библиотека блоков</span>
            <UiIcon name="close" />
          </button>
          <BlockPalette onAddBlock={addBlock} insideSubsystem={hierarchyStack.length > 0} />

          <details className="panel panel--flush examples-panel">
            <summary className="panel-heading">
              <div>
                <span className="panel-kicker">Быстрый старт</span>
                <h2>Готовые схемы</h2>
              </div>
              <span className="examples-panel__count">{EXAMPLE_PRESETS.length}</span>
              <UiIcon name="chevron" />
            </summary>
            <div className="example-list">
              {EXAMPLE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    applyPreset(preset);
                  }}
                  data-testid={`load-example-${preset.id}`}
                >
                  <span>{preset.title}</span>
                  <UiIcon name="chevron" />
                </button>
              ))}
            </div>
          </details>
        </aside>

        <section className="modeling-main" ref={modelingMainRef} style={modelingMainStyle}>
          <section className="canvas-pane">
            <header className="canvas-caption">
              <div className="canvas-caption__context">
                <span className="canvas-caption__eyebrow">Структурная схема · уровень {hierarchyStack.length}</span>
                <h1>{currentLevelTitle}</h1>
                {hierarchyStack.length > 0 && <nav className="hierarchy-breadcrumb" aria-label="Уровень подсистемы">
                  <button
                    type="button"
                    className={hierarchyStack.length === 0 ? "is-current" : ""}
                    onClick={() => leaveSubsystemToDepth(0)}
                    disabled={hierarchyStack.length === 0}
                  >
                    Главная схема
                  </button>
                  {hiddenHierarchyParts.length > 0 && (
                    <details className="hierarchy-breadcrumb__collapsed">
                      <summary title={`${hiddenHierarchyParts.length} скрытых уровня`}>
                        … {hiddenHierarchyParts.length}
                      </summary>
                      <div>
                        {hiddenHierarchyParts.map((part) => (
                          <button
                            key={`${part.depth}-${part.label}`}
                            type="button"
                            onClick={(event) => {
                              event.currentTarget.closest("details")?.removeAttribute("open");
                              leaveSubsystemToDepth(part.depth);
                            }}
                          >
                            <span>Уровень {part.depth}</span>
                            {part.label}
                          </button>
                        ))}
                      </div>
                    </details>
                  )}
                  {visibleHierarchyParts.slice(1).map((part) => {
                    const isCurrent = part.depth === hierarchyStack.length;
                    return (
                      <button
                        key={`${part.depth}-${part.label}`}
                        type="button"
                        className={isCurrent ? "is-current" : ""}
                        onClick={() => leaveSubsystemToDepth(part.depth)}
                        disabled={isCurrent}
                      >
                        {part.label}
                      </button>
                    );
                  })}
                </nav>}
              </div>
              <div className="canvas-caption__actions">
                {hierarchyStack.length > 0 && (
                  <button type="button" className="btn btn-secondary" onClick={leaveSubsystem} data-testid="leave-subsystem-button">
                    ← На уровень выше
                  </button>
                )}
                <span className="canvas-caption__hint">Двойной клик — параметры · Delete — удалить</span>
              </div>
            </header>
            <div id="diagram-workbench" className="canvas-wrapper" onDragOver={onDragOver} onDrop={onDrop} data-testid="diagram-canvas" tabIndex={-1}>
              {nodes.length === 0 && (
                <div className="canvas-empty-state canvas-starter">
                  <header className="canvas-starter__intro">
                    <div>
                      <strong>Соберите первый контур</strong>
                      <p>Выберите готовую топологию или перенесите блок из библиотеки.</p>
                    </div>
                  </header>
                  <div className="canvas-starter__visual">
                    <img src="/axiom-signal-flow.png" alt="" aria-hidden="true" />
                  </div>
                  <div className="canvas-starter__grid">
                    {STARTER_PRESETS.map((starter) => (
                      <button
                        key={starter.id}
                        type="button"
                        onClick={() => applyPreset(starter.preset)}
                        data-testid={`starter-example-${starter.id}`}
                      >
                        <span>{starter.category}</span>
                        <strong>{starter.title}</strong>
                        <small>{starter.description}</small>
                      </button>
                    ))}
                  </div>
                  <p className="canvas-starter__manual"><span>→</span> Перетащите любой блок на сетку — позиция привяжется к шагу 8 px</p>
                </div>
              )}
              <ReactFlow
                nodes={renderedNodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onSelectionChange={({ nodes: selected }) => {
                  const nextSelectedId = selected[0]?.id ?? null;
                  setSelectedNodeId(nextSelectedId);
                }}
                onNodeDoubleClick={(_, node) => {
                  if (nodeClickTimerRef.current !== null) {
                    window.clearTimeout(nodeClickTimerRef.current);
                    nodeClickTimerRef.current = null;
                  }
                  setSelectedNodeId(node.id);
                  setInspectorView("block");
                  setIsInspectorOpen(true);
                  setIsLibraryCollapsed(true);
                  if (node.data.blockType === "Subsystem") {
                    enterSubsystem(node.id);
                    setIsInspectorOpen(false);
                  } else {
                    setIsParameterModalOpen(true);
                    setIsInspectorOpen(false);
                  }
                }}
                onNodeClick={(_, node) => {
                  if (nodeClickTimerRef.current !== null) window.clearTimeout(nodeClickTimerRef.current);
                  nodeClickTimerRef.current = window.setTimeout(() => {
                    setSelectedNodeId(node.id);
                    setInspectorView("block");
                    setIsInspectorOpen(true);
                    setIsLibraryCollapsed(true);
                    nodeClickTimerRef.current = null;
                  }, 180);
                }}
                onPaneClick={() => {
                  if (nodeClickTimerRef.current !== null) {
                    window.clearTimeout(nodeClickTimerRef.current);
                    nodeClickTimerRef.current = null;
                  }
                  setSelectedNodeId(null);
                  setInspectorView("simulation");
                  setIsInspectorOpen(false);
                }}
                nodeTypes={NODE_TYPES}
                edgeTypes={EDGE_TYPES}
                defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
                connectionLineType={ConnectionLineType.Step}
                fitView
                fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
                minZoom={0.18}
                maxZoom={1.35}
              >
                {nodes.length > 8 && <MiniMap pannable zoomable maskColor="rgba(0, 0, 0, 0.92)" nodeColor="#8d8d8d" />}
                <Controls />
                <Background variant={BackgroundVariant.Lines} gap={30} size={0.55} color="#222222" />
              </ReactFlow>
            </div>
          </section>

          {isScopeOpen && (
            <div className={`scope-splitter ${isResizingScope ? "is-active" : ""}`} role="separator" aria-label="Изменить высоту панели результатов" aria-orientation="horizontal" onMouseDown={startScopeResize} onDoubleClick={() => setScopeHeightPx(420)}>
              <span />
            </div>
          )}

          <section className={`scope-dock ${isScopeOpen ? "is-open" : "is-collapsed"} ${result?.success && isScopeOpen ? "has-result" : "has-diagnostics-only"}`}>
            {isScopeOpen && result?.success && (
              <SimulationChart
                result={result}
                previousResult={previousResult}
                collapsed={false}
                onToggleCollapsed={() => {
                  setIsScopeOpen(false);
                  setScopeTab("plot");
                }}
                requestedTab={scopeTab}
                onTabChange={setScopeTab}
              />
            )}
            {!result?.success && <DiagnosticsPanel
              className="run-diagnostics-panel"
              state={effectiveDiagnosticsState}
              statusLabel={effectiveDiagnosticsState === "success" && !result?.success ? "Схема проверена" : undefined}
              issues={panelIssues}
              progress={diagnosticsProgress}
              results={diagnosticResults}
              activeTab={diagnosticsTab}
              collapsed={!isScopeOpen || isDiagnosticsCollapsed}
              onTabChange={setDiagnosticsTab}
              onCollapsedChange={(collapsed) => {
                setIsDiagnosticsCollapsed(collapsed);
                if (!collapsed) {
                  setIsScopeOpen(true);
                } else if (!result?.success) {
                  setIsScopeOpen(false);
                }
              }}
              onIssueClick={focusDiagnosticIssue}
            />}
          </section>
        </section>

        {isInspectorOpen && <WorkspaceInspector
          selectedNode={selectedNode}
          selectedNodeId={selectedNodeId}
          selectedNodeTitle={selectedNodeTitle}
          currentLevelTitle={currentLevelTitle}
          info={info}
          view={inspectorView}
          onViewChange={setInspectorView}
          onClose={() => setIsInspectorOpen(false)}
          solver={solver}
          onSolverChange={setSolver}
          tEnd={tEnd}
          onTEndChange={setTEnd}
          dt={dt}
          onDtChange={setDt}
          onValidate={runValidation}
          onOpenParameters={() => setIsParameterModalOpen(true)}
          onDeleteSelected={deleteSelectedNode}
          onEnterSubsystem={enterSubsystem}
          nodeCount={nodes.length}
          edgeCount={edges.length}
          hierarchyDepth={hierarchyStack.length}
        />}
      </section>

      <ParameterEditor
        open={isParameterModalOpen}
        selectedNode={selectedNode}
        connectedInputPorts={selectedConnectedInputPorts}
        onClose={() => setIsParameterModalOpen(false)}
        onParametersApply={applySelectedParameters}
      />
      <ServerProjectsModal
        open={isServerProjectsOpen}
        currentProjectId={serverProjectId}
        isBusy={isBusy}
        onClose={() => setIsServerProjectsOpen(false)}
        onCreate={createProjectOnServer}
        onOpen={openProjectFromServer}
        onCurrentDeleted={() => {
          setServerProjectId(null);
          setServerProjectVersion(null);
          setServerProjectTitle("");
        }}
      />
    </main>
  );
}

type StepStatus = [DiagnosticProgressStatus, string?];

export function MainPage() {
  return (
    <ReactFlowProvider>
      <ModelingWorkspace />
    </ReactFlowProvider>
  );
}

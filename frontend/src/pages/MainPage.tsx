import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent
} from "react";
import ReactFlow, {
  Background,
  ConnectionLineType,
  Controls,
  MarkerType,
  MiniMap,
  addEdge,
  type Connection,
  type DefaultEdgeOptions,
  type Edge,
  type Node,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useUpdateNodeInternals,
  useReactFlow
} from "reactflow";
import { simulateDiagram, SimulationApiError, validateDiagram } from "../api/client";
import { BlockPalette } from "../components/BlockPalette";
import { ErrorPanel } from "../components/ErrorPanel";
import { ParameterEditor } from "../components/ParameterEditor";
import { SimulationChart } from "../components/SimulationChart";
import { BlockNode } from "../nodes/BlockNode";
import { EXAMPLE_PRESETS, type ExamplePreset } from "./examples";
import type { SimulationResponse } from "../types/api";
import {
  blockTypeLabel,
  defaultParametersFor,
  inputPortsFor,
  isBlockType,
  outputPortsFor,
  type BlockNodeData,
  type BlockType,
  type Diagram,
  type DiagramBlock
} from "../types/diagram";

const NODE_TYPES = { block: BlockNode };
type DiagramNode = Node<BlockNodeData>;
const EDGE_TYPE = "smoothstep" as const;
const EDGE_PATH_OPTIONS = { offset: 36, borderRadius: 12 };
const FEEDBACK_EDGE_PATH_OPTIONS = { offset: 96, borderRadius: 12 };
const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
  type: EDGE_TYPE,
  markerEnd: { type: MarkerType.ArrowClosed }
};

function defaultPosition(index: number): { x: number; y: number } {
  return { x: 80 + (index % 3) * 220, y: 100 + Math.floor(index / 3) * 130 };
}

function toNode(block: DiagramBlock, position: { x: number; y: number }): DiagramNode {
  return {
    id: block.id,
    type: "block",
    position,
    data: {
      blockId: block.id,
      blockType: block.type,
      parameters: block.parameters,
      inputPorts: block.input_ports,
      outputPorts: block.output_ports
    }
  };
}

function isFeedbackByPosition(
  source: string,
  target: string,
  positions: Record<string, { x: number; y: number }>
): boolean {
  const sourcePosition = positions[source];
  const targetPosition = positions[target];
  return Boolean(sourcePosition && targetPosition && sourcePosition.x > targetPosition.x);
}

function edgeClassName(isFeedback: boolean): string | undefined {
  return isFeedback ? "feedback-edge" : undefined;
}

function edgeDataWithKind(data: Edge["data"], isFeedback: boolean): Edge["data"] {
  if (isFeedback) {
    return { ...(data ?? {}), kind: "feedback" };
  }
  if (!data || typeof data !== "object" || !("kind" in data)) {
    return data;
  }
  const { kind: _kind, ...rest } = data as Record<string, unknown>;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

function routeEdge(edge: Edge, positions: Record<string, { x: number; y: number }>): Edge {
  const isFeedback = isFeedbackByPosition(edge.source, edge.target, positions);
  return {
    ...edge,
    type: EDGE_TYPE,
    markerEnd: { type: MarkerType.ArrowClosed },
    className: edgeClassName(isFeedback),
    data: edgeDataWithKind(edge.data, isFeedback),
    pathOptions: isFeedback ? FEEDBACK_EDGE_PATH_OPTIONS : EDGE_PATH_OPTIONS
  };
}

function edgesFromDiagram(
  diagram: Diagram,
  positions: Record<string, { x: number; y: number }>
): Edge[] {
  return diagram.connections.map((connection, index) =>
    routeEdge(
      {
        id: `edge-${index}-${connection.from_block}-${connection.to_block}`,
        source: connection.from_block,
        sourceHandle: connection.from_port,
        target: connection.to_block,
        targetHandle: connection.to_port
      },
      positions
    )
  );
}

function positionsFromNodes(nodes: DiagramNode[]): Record<string, { x: number; y: number }> {
  return Object.fromEntries(nodes.map((node) => [node.id, node.position]));
}

function diagramHasCycle(diagram: Diagram): boolean {
  const adjacency = new Map<string, string[]>();
  for (const block of diagram.blocks) {
    adjacency.set(block.id, []);
  }
  for (const connection of diagram.connections) {
    adjacency.get(connection.from_block)?.push(connection.to_block);
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(blockId: string): boolean {
    if (visiting.has(blockId)) {
      return true;
    }
    if (visited.has(blockId)) {
      return false;
    }
    visiting.add(blockId);
    for (const nextBlockId of adjacency.get(blockId) ?? []) {
      if (visit(nextBlockId)) {
        return true;
      }
    }
    visiting.delete(blockId);
    visited.add(blockId);
    return false;
  }

  return diagram.blocks.some((block) => visit(block.id));
}

function formatValidationMessage(message: string): string {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("algebraic") ||
    normalized.includes("cycle") ||
    normalized.includes("loop") ||
    normalized.includes("direct-feedthrough") ||
    normalized.includes("алгебра") ||
    normalized.includes("петл")
  ) {
    return "Алгебраическая петля: в цикле нет динамического блока или есть direct-feedthrough зависимость.";
  }
  return message;
}

function blockedSumInputMessage(portName: string): string {
  return `Нельзя удалить вход Sum.${portName}: к нему подключена связь.`;
}

function diagramFromFlow(nodes: DiagramNode[], edges: Edge[]): Diagram {
  return {
    blocks: nodes.map((node) => ({
      id: node.id,
      type: node.data.blockType,
      parameters: node.data.parameters,
      input_ports: node.data.inputPorts,
      output_ports: node.data.outputPorts
    })),
    connections: edges.map((edge) => ({
      from_block: edge.source,
      from_port: edge.sourceHandle ?? "out",
      to_block: edge.target,
      to_port: edge.targetHandle ?? "in"
    }))
  };
}

function ModelingWorkspace() {
  const [nodes, setNodes, onNodesChange] = useNodesState<BlockNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [result, setResult] = useState<SimulationResponse | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [info, setInfo] = useState<string>("");
  const [solver, setSolver] = useState<"rk4" | "solve_ivp">("solve_ivp");
  const [tEnd, setTEnd] = useState<number>(6);
  const [dt, setDt] = useState<number>(0.01);
  const [isBusy, setIsBusy] = useState(false);
  const [isParameterModalOpen, setIsParameterModalOpen] = useState(false);
  const [scopeHeightPx, setScopeHeightPx] = useState(560);
  const [isResizingScope, setIsResizingScope] = useState(false);
  const [nodeCounter, setNodeCounter] = useState(1);
  const modelingMainRef = useRef<HTMLElement | null>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();

  const modelingMainStyle = useMemo(
    () => ({ ["--scope-height" as string]: `${scopeHeightPx}px` }) as CSSProperties,
    [scopeHeightPx]
  );

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId)?.data ?? null,
    [nodes, selectedNodeId]
  );

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
    [nodes]
  );

  useEffect(() => {
    setEdges((current) => current.map((edge) => routeEdge(edge, nodePositions)));
  }, [nodePositions, setEdges]);

  useEffect(() => {
    function onKeydown(event: KeyboardEvent) {
      if (event.key !== "Delete" || !selectedNodeId) {
        return;
      }
      setNodes((current) => current.filter((node) => node.id !== selectedNodeId));
      setEdges((current) =>
        current.filter(
          (edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId
        )
      );
      setSelectedNodeId(null);
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
      const maxScope = Math.max(minScope, containerHeight - minCanvas - splitter);
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

  function startScopeResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsResizingScope(true);
  }

  function addBlock(type: BlockType, position?: { x: number; y: number }) {
    const id = `${type}-${nodeCounter}`;
    setNodeCounter((value) => value + 1);
    const parameters = defaultParametersFor(type);
    const inputPorts = inputPortsFor(type, parameters);
    const outputPorts = outputPortsFor(type);
    const node: DiagramNode = {
      id,
      type: "block",
      position: position ?? defaultPosition(nodes.length),
      data: {
        blockId: id,
        blockType: type,
        parameters,
        inputPorts,
        outputPorts
      }
    };
    setNodes((current) => [...current, node]);
  }

  function applyPreset(preset: ExamplePreset) {
    const loadedNodes = preset.diagram.blocks.map((block, index) =>
      toNode(block, preset.positions[block.id] ?? defaultPosition(index))
    );
    setNodes(loadedNodes);
    setEdges(edgesFromDiagram(preset.diagram, preset.positions));
    setNodeCounter(loadedNodes.length + 1);
    setSelectedNodeId(null);
    setErrors([]);
    setInfo(`Загружен пример: ${preset.title}`);
    setResult(null);
    setTimeout(() => {
      void fitView({ padding: 0.2, duration: 250 });
    }, 0);
  }

  function onConnect(connection: Connection) {
    if (!connection.source || !connection.target) {
      return;
    }
    const targetHandle = connection.targetHandle ?? "in";
    const occupied = edges.some(
      (edge) => edge.target === connection.target && (edge.targetHandle ?? "in") === targetHandle
    );
    if (occupied) {
      setErrors([
        `Вход ${connection.target}.${targetHandle} уже имеет связь. Один вход может иметь только один источник.`
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
      id: `edge-${connection.source}-${connection.target}-${Date.now()}`
    };
    setEdges((current) => addEdge(routeEdge(edge, nodePositions), current));
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const droppedType = event.dataTransfer.getData("application/nir-block-type");
    if (!isBlockType(droppedType)) {
      return;
    }
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
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
    const nextOutputPorts = outputPortsFor(node.data.blockType);
    const blockedInputEdge = edges.find(
      (edge) =>
        edge.target === selectedId &&
        !nextInputPorts.includes(edge.targetHandle ?? "in")
    );

    if (node.data.blockType === "Sum" && blockedInputEdge?.targetHandle) {
      setErrors([blockedSumInputMessage(blockedInputEdge.targetHandle)]);
      setInfo("");
      return;
    }

    const inputCountChanged = node.data.inputPorts.length !== nextInputPorts.length;

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
            outputPorts: nextOutputPorts
          }
        };
      })
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

    if (node.data.blockType === "Sum" && inputCountChanged) {
      window.setTimeout(() => updateNodeInternals(selectedId), 0);
    }
  }

  async function runValidation() {
    setInfo("");
    setResult(null);
    const diagram = diagramFromFlow(nodes as DiagramNode[], edges);
    try {
      const response = await validateDiagram(diagram);
      if (response.valid) {
        setErrors([]);
        setInfo(
          diagramHasCycle(diagram)
            ? "Обратная связь допустима: цикл проходит через динамический блок."
            : "Схема корректна."
        );
      } else {
        setErrors(response.errors.map(formatValidationMessage));
        setInfo("");
      }
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Не удалось выполнить проверку схемы."]);
    }
  }

  async function runSimulation() {
    if (dt <= 0 || tEnd <= 0) {
      setErrors(["Параметры моделирования должны удовлетворять условиям: t_end > 0 и dt > 0."]);
      return;
    }

    setInfo("");
    setErrors([]);
    setIsBusy(true);
    const diagram = diagramFromFlow(nodes as DiagramNode[], edges);
    try {
      const response = await simulateDiagram({
        diagram,
        t_start: 0,
        t_end: tEnd,
        dt,
        solver
      });
      setResult(response);
    } catch (error) {
      setResult(null);
      if (error instanceof SimulationApiError) {
        setErrors(
          (error.validationErrors.length > 0 ? error.validationErrors : [error.message]).map(
            formatValidationMessage
          )
        );
      } else {
        setErrors([error instanceof Error ? error.message : "Не удалось выполнить моделирование."]);
      }
    } finally {
      setIsBusy(false);
    }
  }

  function clearDiagram() {
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    setResult(null);
    setErrors([]);
    setInfo("");
    setIsParameterModalOpen(false);
  }

  function deleteSelectedNode() {
    if (!selectedNodeId) {
      return;
    }
    setNodes((current) => current.filter((node) => node.id !== selectedNodeId));
    setEdges((current) =>
      current.filter(
        (edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId
      )
    );
    setSelectedNodeId(null);
    setIsParameterModalOpen(false);
  }

  return (
    <main className="simulink-root">
      <header className="toolstrip">
        <div className="toolstrip__title">
          <h1>НИР: прототип визуального моделирования</h1>
          <p>Собирайте блок-схемы, проверяйте структуру и моделируйте переходные процессы.</p>
        </div>

        <div className="toolstrip__group">
          <label className="tool-input">
            <span>Решатель</span>
            <select
              value={solver}
              onChange={(event) => setSolver(event.target.value as "rk4" | "solve_ivp")}
              data-testid="solver-select"
            >
              <option value="solve_ivp">solve_ivp</option>
              <option value="rk4">rk4</option>
            </select>
          </label>
          <label className="tool-input">
            <span>t_end</span>
            <input
              type="number"
              value={tEnd}
              onChange={(event) => setTEnd(Number(event.target.value))}
            />
          </label>
          <label className="tool-input">
            <span>dt</span>
            <input
              type="number"
              value={dt}
              step="0.001"
              onChange={(event) => setDt(Number(event.target.value))}
            />
          </label>
        </div>

        <div className="toolstrip__actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={runValidation}
            data-testid="validate-button"
          >
            Проверить
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={runSimulation}
            data-testid="simulate-button"
          >
            {isBusy ? "Расчёт..." : "Смоделировать"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void fitView({ padding: 0.2, duration: 250 })}
          >
            Вписать схему
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setIsParameterModalOpen(true)}
          >
            Параметры
          </button>
          <button
            type="button"
            className="btn btn-danger-soft"
            onClick={deleteSelectedNode}
            disabled={!selectedNodeId}
          >
            Удалить блок
          </button>
          <button
            type="button"
            className="btn"
            onClick={clearDiagram}
            data-testid="clear-button"
          >
            Очистить
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="library-pane">
          <BlockPalette onAddBlock={addBlock} />

          <section className="panel">
            <h2>Примеры</h2>
            <div className="example-list">
              {EXAMPLE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  data-testid={`load-example-${preset.id}`}
                >
                  {preset.title}
                </button>
              ))}
            </div>
          </section>

          <section className="panel selection-panel">
            <h2>Выбранный блок</h2>
            {selectedNode ? (
              <>
                <p>
                  <strong>{blockTypeLabel(selectedNode.blockType)}</strong> ({selectedNode.blockId})
                </p>
                <p>Дважды кликните блок или нажмите «Параметры».</p>
              </>
            ) : (
              <p>Выберите блок, чтобы просмотреть и изменить его параметры.</p>
            )}
            {info && <p className="info-text">{info}</p>}
          </section>

          <section className="panel loop-help-panel">
            <h2>Как собрать замкнутый контур</h2>
            <ol>
              <li>r(t) подключите к + входу Sum.</li>
              <li>y(t) подключите к - входу Sum.</li>
              <li>Sum.out подключите к регулятору.</li>
              <li>Регулятор подключите к объекту.</li>
              <li>Выход объекта подключите к Scope и к обратной связи.</li>
            </ol>
          </section>
        </aside>

        <section className="modeling-main" ref={modelingMainRef} style={modelingMainStyle}>
          <section className="canvas-pane">
            <div className="canvas-caption">
              <span>Рабочее поле схемы</span>
              <span>
                Блоков: {nodes.length} - Связей: {edges.length}
              </span>
              <span className="canvas-caption__hint">
                Положение проводов рассчитывается автоматически. Для изменения маршрута переместите блоки.
              </span>
            </div>
            <div
              className="canvas-wrapper"
              onDragOver={onDragOver}
              onDrop={onDrop}
              data-testid="diagram-canvas"
            >
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onSelectionChange={({ nodes: selected }) =>
                  setSelectedNodeId(selected[0]?.id ?? null)
                }
                onNodeDoubleClick={(_, node) => {
                  setSelectedNodeId(node.id);
                  setIsParameterModalOpen(true);
                }}
                onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                onPaneClick={() => setSelectedNodeId(null)}
                nodeTypes={NODE_TYPES}
                defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
                connectionLineType={ConnectionLineType.SmoothStep}
                fitView
              >
                <MiniMap pannable zoomable />
                <Controls />
                <Background gap={22} color="#ced7e2" />
              </ReactFlow>
            </div>
          </section>

          <div
            className={`scope-splitter ${isResizingScope ? "is-active" : ""}`}
            role="separator"
            aria-label="Изменить высоту панели осциллографа"
            aria-orientation="horizontal"
            onMouseDown={startScopeResize}
            onDoubleClick={() => setScopeHeightPx(520)}
          >
            <span />
          </div>

          <section className="scope-dock">
            <SimulationChart result={result} />
            <ErrorPanel errors={errors} />
          </section>
        </section>
      </section>

      <ParameterEditor
        open={isParameterModalOpen}
        selectedNode={selectedNode}
        connectedInputPorts={selectedConnectedInputPorts}
        onClose={() => setIsParameterModalOpen(false)}
        onParametersApply={applySelectedParameters}
      />
    </main>
  );
}

export function MainPage() {
  return (
    <ReactFlowProvider>
      <ModelingWorkspace />
    </ReactFlowProvider>
  );
}

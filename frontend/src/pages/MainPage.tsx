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
  Controls,
  MiniMap,
  addEdge,
  type Connection,
  type Edge,
  type Node,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
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

function edgesFromDiagram(diagram: Diagram): Edge[] {
  return diagram.connections.map((connection, index) => ({
    id: `edge-${index}-${connection.from_block}-${connection.to_block}`,
    source: connection.from_block,
    sourceHandle: connection.from_port,
    target: connection.to_block,
    targetHandle: connection.to_port
  }));
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

  const modelingMainStyle = useMemo(
    () => ({ ["--scope-height" as string]: `${scopeHeightPx}px` }) as CSSProperties,
    [scopeHeightPx]
  );

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId)?.data ?? null,
    [nodes, selectedNodeId]
  );

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
    setEdges(edgesFromDiagram(preset.diagram));
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
    const edge: Edge = {
      ...connection,
      source: connection.source,
      target: connection.target,
      id: `edge-${connection.source}-${connection.target}-${Date.now()}`
    };
    setEdges((current) => addEdge(edge, current));
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

    let updatedInputPorts: string[] | undefined;
    let updatedOutputPorts: string[] | undefined;

    setNodes((current) =>
      current.map((node) => {
        if (node.id !== selectedId) {
          return node;
        }
        const nextParameters = { ...node.data.parameters, ...updates };
        const nextInputPorts = inputPortsFor(node.data.blockType, nextParameters);
        const nextOutputPorts = outputPortsFor(node.data.blockType);
        updatedInputPorts = nextInputPorts;
        updatedOutputPorts = nextOutputPorts;
        return {
          ...node,
          data: {
            ...node.data,
            parameters: nextParameters,
            inputPorts: nextInputPorts,
            outputPorts: nextOutputPorts
          }
        };
      })
    );

    setEdges((current) => {
      if (!updatedInputPorts || !updatedOutputPorts) {
        return current;
      }
      const allowedInputs = new Set(updatedInputPorts);
      const allowedOutputs = new Set(updatedOutputPorts);
      return current.filter((edge) => {
        if (
          edge.target === selectedId &&
          edge.targetHandle &&
          !allowedInputs.has(edge.targetHandle)
        ) {
          return false;
        }
        if (
          edge.source === selectedId &&
          edge.sourceHandle &&
          !allowedOutputs.has(edge.sourceHandle)
        ) {
          return false;
        }
        return true;
      });
    });
  }

  async function runValidation() {
    setInfo("");
    setResult(null);
    const diagram = diagramFromFlow(nodes as DiagramNode[], edges);
    try {
      const response = await validateDiagram(diagram);
      if (response.valid) {
        setErrors([]);
        setInfo("Схема корректна.");
      } else {
        setErrors(response.errors);
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
        setErrors(error.validationErrors.length > 0 ? error.validationErrors : [error.message]);
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
        </aside>

        <section className="modeling-main" ref={modelingMainRef} style={modelingMainStyle}>
          <section className="canvas-pane">
            <div className="canvas-caption">
              <span>Рабочее поле схемы</span>
              <span>
                Блоков: {nodes.length} - Связей: {edges.length}
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

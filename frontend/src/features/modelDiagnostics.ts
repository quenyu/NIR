import {
  BLOCK_TYPES,
  inputPortsFor,
  outputPortsFor,
  type BlockNodeData,
  type BlockType,
  type Diagram,
  type DiagramBlock,
  type DiagramConnection,
} from "../types/diagram";

export type DiagnosticSeverity = "error" | "warning" | "info";

export type DiagnosticCode =
  | "empty-model"
  | "missing-source"
  | "missing-output"
  | "duplicate-node-id"
  | "unknown-block-type"
  | "interface-block-outside-subsystem"
  | "invalid-parameter"
  | "port-mismatch"
  | "unknown-source-node"
  | "unknown-target-node"
  | "unknown-source-port"
  | "unknown-target-port"
  | "self-connection"
  | "duplicate-connection"
  | "input-occupied"
  | "required-input-unconnected"
  | "output-unconnected"
  | "missing-forward-path"
  | "algebraic-loop"
  | "feedback-valid"
  | "nested-diagram-invalid"
  | "model-ready";

export interface ModelDiagnosticIssue {
  id: string;
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  nodeId?: string;
  /** All blocks involved when one diagnostic belongs to a complete contour. */
  nodeIds?: string[];
  edgeId?: string;
  portId?: string;
  /** IDs of parent Subsystem blocks, from the root to the current diagram. */
  scopePath: string[];
}

export interface ModelDiagnosticCounts {
  error: number;
  warning: number;
  info: number;
}

export interface ModelDiagnosticReport {
  issues: ModelDiagnosticIssue[];
  counts: ModelDiagnosticCounts;
  hasErrors: boolean;
  hasWarnings: boolean;
  canRun: boolean;
}

export interface DiagnoseDiagramOptions {
  /** React Flow edge IDs in the same order as diagram.connections. */
  edgeIds?: readonly string[];
}

/** Structural types keep the diagnostics engine independent from React Flow. */
export interface DiagnosticFlowNode {
  id: string;
  data: Pick<
    BlockNodeData,
    "blockType" | "parameters" | "inputPorts" | "outputPorts"
  >;
}

export interface DiagnosticFlowEdge {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
}

interface Collector {
  issues: ModelDiagnosticIssue[];
  nextOrdinal: number;
  seenDiagrams: WeakSet<object>;
}

interface ValidConnection {
  connection: DiagramConnection;
  edgeId: string;
}

interface ExpectedPorts {
  input: string[];
  output: string[];
}

const SEVERITY_ORDER: Record<DiagnosticSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

const NUMERIC_DEFAULTS: Partial<
  Record<BlockType, Record<string, number>>
> = {
  StepInput: { amplitude: 1, t0: 0 },
  Gain: { k: 1 },
  Integrator: { k: 1, y0: 0 },
  FirstOrderLag: { k: 1, T: 1, y0: 0 },
  SecondOrderOscillator: { k: 1, wn: 1, zeta: 0.2, y0: 0, v0: 0 },
  ButterworthLPF: { order: 2, cutoff_freq: 10, y0: 0 },
  PIDController: { kp: 1, ki: 0, kd: 0, filter_n: 20 },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isKnownBlockType(value: unknown): value is BlockType {
  return typeof value === "string" && BLOCK_TYPES.includes(value as BlockType);
}

function scopeKey(scopePath: readonly string[]): string {
  return scopePath.length > 0 ? scopePath.join("/") : "root";
}

function addIssue(
  collector: Collector,
  issue: Omit<ModelDiagnosticIssue, "id" | "scopePath"> & {
    scopePath?: readonly string[];
  },
): void {
  const path = [...(issue.scopePath ?? [])];
  const reference = issue.edgeId ?? issue.nodeId ?? issue.portId ?? "model";
  const id = `${scopeKey(path)}:${issue.code}:${reference}:${collector.nextOrdinal}`;
  collector.nextOrdinal += 1;
  collector.issues.push({ ...issue, id, scopePath: path });
}

function connectionEdgeId(connection: DiagramConnection, index: number): string {
  return `edge-${index}-${connection.from_block}-${connection.to_block}`;
}

function finiteNumericParameter(
  block: DiagramBlock,
  key: string,
  fallback: number,
  collector: Collector,
  scopePath: readonly string[],
): number | null {
  const raw = block.parameters[key] ?? fallback;
  if (
    typeof raw === "boolean" ||
    raw === null ||
    (typeof raw === "string" && raw.trim().length === 0) ||
    (typeof raw !== "number" && typeof raw !== "string")
  ) {
    addIssue(collector, {
      code: "invalid-parameter",
      severity: "error",
      message: `Блок «${block.id}»: параметр ${key} должен быть числом.`,
      nodeId: block.id,
      portId: key,
      scopePath,
    });
    return null;
  }

  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed)) {
    addIssue(collector, {
      code: "invalid-parameter",
      severity: "error",
      message: `Блок «${block.id}»: параметр ${key} должен быть конечным числом.`,
      nodeId: block.id,
      portId: key,
      scopePath,
    });
    return null;
  }
  return parsed;
}

function numericVectorParameter(
  block: DiagramBlock,
  key: string,
  fallback: readonly number[],
  collector: Collector,
  scopePath: readonly string[],
): number[] | null {
  const raw = block.parameters[key] ?? fallback;
  if (!Array.isArray(raw) || raw.length === 0) {
    addIssue(collector, {
      code: "invalid-parameter",
      severity: "error",
      message: `Блок «${block.id}»: параметр ${key} должен быть непустым массивом чисел.`,
      nodeId: block.id,
      portId: key,
      scopePath,
    });
    return null;
  }

  const parsed = raw.map((value) => {
    if (
      typeof value === "boolean" ||
      value === null ||
      (typeof value === "string" && value.trim().length === 0) ||
      (typeof value !== "number" && typeof value !== "string")
    ) {
      return Number.NaN;
    }
    return typeof value === "number" ? value : Number(value);
  });
  if (parsed.some((value) => !Number.isFinite(value))) {
    addIssue(collector, {
      code: "invalid-parameter",
      severity: "error",
      message: `Блок «${block.id}»: параметр ${key} содержит нечисловое значение.`,
      nodeId: block.id,
      portId: key,
      scopePath,
    });
    return null;
  }
  return parsed;
}

function polynomialOrder(coefficients: readonly number[]): number {
  const firstNonZero = coefficients.findIndex((coefficient) => coefficient !== 0);
  return firstNonZero < 0 ? 0 : coefficients.length - firstNonZero - 1;
}

function addParameterRangeIssue(
  collector: Collector,
  block: DiagramBlock,
  key: string,
  condition: boolean,
  requirement: string,
  scopePath: readonly string[],
): void {
  if (condition) {
    return;
  }
  addIssue(collector, {
    code: "invalid-parameter",
    severity: "error",
    message: `Блок «${block.id}»: ${key} ${requirement}.`,
    nodeId: block.id,
    portId: key,
    scopePath,
  });
}

function validateBlockParameters(
  block: DiagramBlock,
  collector: Collector,
  scopePath: readonly string[],
): void {
  const defaults = NUMERIC_DEFAULTS[block.type];
  if (defaults) {
    for (const [key, fallback] of Object.entries(defaults)) {
      finiteNumericParameter(block, key, fallback, collector, scopePath);
    }
  }

  switch (block.type) {
    case "FirstOrderLag": {
      const value = finiteNumberWithoutIssue(block.parameters.T ?? 1);
      if (value !== null) {
        addParameterRangeIssue(collector, block, "T", value > 0, "должно быть больше 0", scopePath);
      }
      break;
    }
    case "SecondOrderOscillator": {
      const wn = finiteNumberWithoutIssue(block.parameters.wn ?? 1);
      const zeta = finiteNumberWithoutIssue(block.parameters.zeta ?? 0.2);
      if (wn !== null) {
        addParameterRangeIssue(collector, block, "wn", wn > 0, "должно быть больше 0", scopePath);
      }
      if (zeta !== null) {
        addParameterRangeIssue(collector, block, "zeta", zeta >= 0, "не должно быть меньше 0", scopePath);
      }
      break;
    }
    case "TransferFunction": {
      const numerator = numericVectorParameter(block, "numerator", [1], collector, scopePath);
      const denominator = numericVectorParameter(block, "denominator", [1, 1], collector, scopePath);
      if (denominator && denominator[0] === 0) {
        addParameterRangeIssue(
          collector,
          block,
          "denominator[0]",
          false,
          "не должно быть равно 0",
          scopePath,
        );
      } else if (
        numerator &&
        denominator &&
        polynomialOrder(numerator) > denominator.length - 1
      ) {
        addParameterRangeIssue(
          collector,
          block,
          "numerator",
          false,
          "не должно иметь порядок выше знаменателя",
          scopePath,
        );
      }
      break;
    }
    case "Sum": {
      const signs = block.parameters.signs ?? ["+", "-"];
      if (
        !Array.isArray(signs) ||
        signs.length === 0 ||
        signs.some((sign) => sign !== "+" && sign !== "-")
      ) {
        addIssue(collector, {
          code: "invalid-parameter",
          severity: "error",
          message: `Блок «${block.id}»: signs должен содержать только знаки «+» и «-».`,
          nodeId: block.id,
          portId: "signs",
          scopePath,
        });
      }
      break;
    }
    case "ButterworthLPF": {
      const order = finiteNumberWithoutIssue(block.parameters.order ?? 2);
      const cutoff = finiteNumberWithoutIssue(block.parameters.cutoff_freq ?? 10);
      if (order !== null) {
        addParameterRangeIssue(
          collector,
          block,
          "order",
          Number.isInteger(order) && order >= 1 && order <= 10,
          "должно быть целым числом от 1 до 10",
          scopePath,
        );
      }
      if (cutoff !== null) {
        addParameterRangeIssue(
          collector,
          block,
          "cutoff_freq",
          cutoff > 0,
          "должно быть больше 0",
          scopePath,
        );
      }
      break;
    }
    case "PIDController": {
      const filterN = finiteNumberWithoutIssue(block.parameters.filter_n ?? 20);
      if (filterN !== null) {
        addParameterRangeIssue(
          collector,
          block,
          "filter_n",
          filterN > 0,
          "должно быть больше 0",
          scopePath,
        );
      }
      break;
    }
    case "SubsystemInput":
    case "SubsystemOutput": {
      const port = block.parameters.port;
      if (typeof port !== "string" || port.trim().length === 0) {
        addIssue(collector, {
          code: "invalid-parameter",
          severity: "error",
          message: `Блок «${block.id}»: имя внешнего порта не задано.`,
          nodeId: block.id,
          portId: "port",
          scopePath,
        });
      }
      break;
    }
    case "Subsystem": {
      const nested = block.parameters.diagram;
      if (
        !isRecord(nested) ||
        !Array.isArray(nested.blocks) ||
        !Array.isArray(nested.connections)
      ) {
        addIssue(collector, {
          code: "nested-diagram-invalid",
          severity: "error",
          message: `Подсистема «${block.id}» не содержит корректной схемы.`,
          nodeId: block.id,
          scopePath,
        });
      }
      break;
    }
    case "Scope": {
      const label = block.parameters.label;
      if (label !== undefined && label !== null && typeof label === "object") {
        addIssue(collector, {
          code: "invalid-parameter",
          severity: "error",
          message: `Блок «${block.id}»: имя сигнала должно быть строкой.`,
          nodeId: block.id,
          portId: "label",
          scopePath,
        });
      }
      if ("reference" in block.parameters) {
        finiteNumericParameter(block, "reference", 0, collector, scopePath);
      }
      break;
    }
    case "StepInput":
    case "Gain":
    case "Integrator":
      break;
  }
}

function finiteNumberWithoutIssue(value: unknown): number | null {
  if (
    typeof value === "boolean" ||
    value === null ||
    (typeof value === "string" && value.trim().length === 0) ||
    (typeof value !== "number" && typeof value !== "string")
  ) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function directFeedthrough(block: DiagramBlock): boolean {
  if (block.type === "Gain" || block.type === "Sum") {
    return true;
  }
  if (block.type === "TransferFunction") {
    const numerator = numericVectorWithoutIssue(block.parameters.numerator ?? [1]);
    const denominator = numericVectorWithoutIssue(block.parameters.denominator ?? [1, 1]);
    if (!numerator || !denominator || denominator.length === 0) {
      return true;
    }
    const denominatorOrder = denominator.length - 1;
    return denominatorOrder === 0 || polynomialOrder(numerator) === denominatorOrder;
  }
  if (block.type === "PIDController") {
    const kp = finiteNumberWithoutIssue(block.parameters.kp ?? 1);
    const ki = finiteNumberWithoutIssue(block.parameters.ki ?? 0);
    const kd = finiteNumberWithoutIssue(block.parameters.kd ?? 0);
    if (kp === null || ki === null || kd === null) {
      return true;
    }
    return kd !== 0 || ki === 0 || kp !== 0;
  }
  if (block.type === "Subsystem") {
    return subsystemHasDirectFeedthrough(block.parameters.diagram);
  }
  return false;
}

function subsystemHasDirectFeedthrough(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.blocks) || !Array.isArray(value.connections)) {
    // Invalid nested models are rejected separately. Conservatism here prevents
    // an invalid wrapper from hiding a possible algebraic loop.
    return true;
  }
  const diagram = value as unknown as Diagram;
  const blocksById = new Map(diagram.blocks.map((block) => [block.id, block]));
  const adjacency = new Map<string, string[]>();
  for (const block of diagram.blocks) {
    adjacency.set(block.id, []);
  }
  for (const connection of diagram.connections) {
    const target = blocksById.get(connection.to_block);
    if (
      !target ||
      (target.type !== "SubsystemOutput" && !directFeedthrough(target))
    ) {
      continue;
    }
    adjacency.get(connection.from_block)?.push(connection.to_block);
  }
  const inputs = diagram.blocks
    .filter((block) => block.type === "SubsystemInput")
    .map((block) => block.id);
  const outputs = new Set(
    diagram.blocks
      .filter((block) => block.type === "SubsystemOutput")
      .map((block) => block.id),
  );
  const reached = reachableFrom(inputs, adjacency);
  return [...outputs].some((outputId) => reached.has(outputId));
}

function numericVectorWithoutIssue(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const parsed = value.map(finiteNumberWithoutIssue);
  return parsed.some((item) => item === null) ? null : (parsed as number[]);
}

function stronglyConnectedComponents(
  nodeIds: readonly string[],
  adjacency: ReadonlyMap<string, readonly string[]>,
): string[][] {
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  function visit(nodeId: string): void {
    indices.set(nodeId, nextIndex);
    lowLinks.set(nodeId, nextIndex);
    nextIndex += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const nextId of adjacency.get(nodeId) ?? []) {
      if (!indices.has(nextId)) {
        visit(nextId);
        lowLinks.set(
          nodeId,
          Math.min(lowLinks.get(nodeId) ?? 0, lowLinks.get(nextId) ?? 0),
        );
      } else if (onStack.has(nextId)) {
        lowLinks.set(
          nodeId,
          Math.min(lowLinks.get(nodeId) ?? 0, indices.get(nextId) ?? 0),
        );
      }
    }

    if (lowLinks.get(nodeId) !== indices.get(nodeId)) {
      return;
    }
    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (member !== undefined) {
        onStack.delete(member);
        component.push(member);
      }
    } while (member !== nodeId && member !== undefined);
    components.push(component);
  }

  for (const nodeId of nodeIds) {
    if (!indices.has(nodeId)) {
      visit(nodeId);
    }
  }
  return components;
}

function reachableFrom(
  sources: readonly string[],
  adjacency: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const reached = new Set<string>(sources);
  const queue = [...sources];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    for (const next of adjacency.get(current) ?? []) {
      if (reached.has(next)) {
        continue;
      }
      reached.add(next);
      queue.push(next);
    }
  }
  return reached;
}

function analyzeFeedback(
  blocksById: ReadonlyMap<string, DiagramBlock>,
  connections: readonly ValidConnection[],
  collector: Collector,
  scopePath: readonly string[],
): void {
  const adjacency = new Map<string, string[]>();
  for (const blockId of blocksById.keys()) {
    adjacency.set(blockId, []);
  }
  for (const { connection } of connections) {
    adjacency.get(connection.from_block)?.push(connection.to_block);
  }

  const components = stronglyConnectedComponents([...blocksById.keys()], adjacency);
  for (const component of components) {
    if (component.length < 2) {
      continue;
    }
    const members = new Set(component);
    const blocks = component
      .map((nodeId) => blocksById.get(nodeId))
      .filter((block): block is DiagramBlock => block !== undefined);
    const representativeEdge = connections.find(
      ({ connection }) =>
        members.has(connection.from_block) && members.has(connection.to_block),
    );
    const dynamicBlock = blocks.find((block) => !directFeedthrough(block));
    if (!dynamicBlock) {
      addIssue(collector, {
        code: "algebraic-loop",
        severity: "error",
        message: `Алгебраическая петля без динамического блока: ${component.join(" → ")}.`,
        nodeId: component[0],
        nodeIds: [...component],
        edgeId: representativeEdge?.edgeId,
        scopePath,
      });
      continue;
    }
    addIssue(collector, {
      code: "feedback-valid",
      severity: "info",
      message: `Обратная связь допустима: контур содержит динамический блок «${dynamicBlock.id}».`,
      nodeId: dynamicBlock.id,
      edgeId: representativeEdge?.edgeId,
      scopePath,
    });
  }
}

function analyzeLevel(
  diagram: Diagram,
  collector: Collector,
  scopePath: readonly string[],
  allowInterfaceBlocks: boolean,
  edgeIds?: readonly string[],
): void {
  if (!isRecord(diagram) || !Array.isArray(diagram.blocks) || !Array.isArray(diagram.connections)) {
    addIssue(collector, {
      code: "nested-diagram-invalid",
      severity: "error",
      message: "Схема имеет некорректный формат.",
      scopePath,
    });
    return;
  }
  if (collector.seenDiagrams.has(diagram)) {
    addIssue(collector, {
      code: "nested-diagram-invalid",
      severity: "error",
      message: "Обнаружена циклическая ссылка на вложенную схему.",
      scopePath,
    });
    return;
  }
  collector.seenDiagrams.add(diagram);

  if (diagram.blocks.length === 0) {
    addIssue(collector, {
      code: "empty-model",
      severity: "error",
      message: "На схеме нет блоков.",
      scopePath,
    });
    return;
  }

  const blocksById = new Map<string, DiagramBlock>();
  const expectedPorts = new Map<string, ExpectedPorts>();

  for (const block of diagram.blocks) {
    if (blocksById.has(block.id)) {
      addIssue(collector, {
        code: "duplicate-node-id",
        severity: "error",
        message: `Идентификатор блока «${block.id}» используется повторно.`,
        nodeId: block.id,
        scopePath,
      });
      continue;
    }
    blocksById.set(block.id, block);

    if (!isKnownBlockType(block.type)) {
      addIssue(collector, {
        code: "unknown-block-type",
        severity: "error",
        message: `Блок «${block.id}» имеет неизвестный тип.`,
        nodeId: block.id,
        scopePath,
      });
      continue;
    }
    if (
      !allowInterfaceBlocks &&
      (block.type === "SubsystemInput" || block.type === "SubsystemOutput")
    ) {
      addIssue(collector, {
        code: "interface-block-outside-subsystem",
        severity: "error",
        message: `Блок «${block.id}» допустим только внутри подсистемы.`,
        nodeId: block.id,
        scopePath,
      });
    }

    validateBlockParameters(block, collector, scopePath);
    const input = inputPortsFor(block.type, block.parameters);
    const output = outputPortsFor(block.type, block.parameters);
    expectedPorts.set(block.id, { input, output });
    if (!arraysEqual(block.input_ports, input)) {
      addIssue(collector, {
        code: "port-mismatch",
        severity: "error",
        message: `Блок «${block.id}»: набор входных портов не соответствует параметрам.`,
        nodeId: block.id,
        scopePath,
      });
    }
    if (!arraysEqual(block.output_ports, output)) {
      addIssue(collector, {
        code: "port-mismatch",
        severity: "error",
        message: `Блок «${block.id}»: набор выходных портов не соответствует параметрам.`,
        nodeId: block.id,
        scopePath,
      });
    }
  }

  const scopeLabels = new Map<string, string>();
  for (const block of diagram.blocks.filter((item) => item.type === "Scope")) {
    const rawLabel = block.parameters.label;
    const requestedLabel = rawLabel === undefined || rawLabel === null
      ? ""
      : String(rawLabel).trim();
    const effectiveLabel = requestedLabel || block.id;
    const previousBlock = scopeLabels.get(effectiveLabel);
    if (previousBlock) {
      addIssue(collector, {
        code: "invalid-parameter",
        severity: "error",
        message: `Осциллографы «${previousBlock}» и «${block.id}» используют одинаковое имя сигнала «${effectiveLabel}».`,
        nodeId: block.id,
        portId: "label",
        scopePath,
      });
    } else {
      scopeLabels.set(effectiveLabel, block.id);
    }
  }

  if (allowInterfaceBlocks) {
    for (const interfaceType of ["SubsystemInput", "SubsystemOutput"] as const) {
      const occupiedPorts = new Set<string>();
      for (const block of diagram.blocks.filter((item) => item.type === interfaceType)) {
        const port = typeof block.parameters.port === "string" ? block.parameters.port.trim() : "";
        if (port && occupiedPorts.has(port)) {
          addIssue(collector, {
            code: "invalid-parameter",
            severity: "error",
            message: `Имя внешнего порта «${port}» используется повторно.`,
            nodeId: block.id,
            portId: port,
            scopePath,
          });
        }
        occupiedPorts.add(port);
      }
    }
  }

  // Hierarchical source/sink wrappers intentionally have no external input or
  // output. Structural detection therefore works for both primitive blocks and
  // compact Subsystem chains.
  const sources = diagram.blocks
    .filter((block) => {
      const ports = expectedPorts.get(block.id);
      return Boolean(ports && ports.input.length === 0 && ports.output.length > 0);
    })
    .map((block) => block.id);
  const outputs = diagram.blocks
    .filter((block) => {
      const ports = expectedPorts.get(block.id);
      return Boolean(ports && ports.input.length > 0 && ports.output.length === 0);
    })
    .map((block) => block.id);

  if (sources.length === 0) {
    addIssue(collector, {
      code: "missing-source",
      severity: "error",
      message: allowInterfaceBlocks
        ? "В подсистеме нет входа или внутреннего источника сигнала."
        : "На схеме нет источника входного сигнала.",
      scopePath,
    });
  }
  if (outputs.length === 0) {
    addIssue(collector, {
      code: "missing-output",
      severity: "error",
      message: allowInterfaceBlocks
        ? "В подсистеме нет выходного или измерительного блока."
        : "На схеме нет выходного или измерительного блока.",
      scopePath,
    });
  }

  const validConnections: ValidConnection[] = [];
  const exactConnections = new Set<string>();
  const occupiedInputs = new Map<string, string>();
  const incoming = new Set<string>();
  const outgoing = new Set<string>();

  diagram.connections.forEach((connection, index) => {
    const edgeId = edgeIds?.[index] ?? connectionEdgeId(connection, index);
    const source = blocksById.get(connection.from_block);
    const target = blocksById.get(connection.to_block);
    if (!source) {
      addIssue(collector, {
        code: "unknown-source-node",
        severity: "error",
        message: `Связь ссылается на отсутствующий блок «${connection.from_block}».`,
        edgeId,
        scopePath,
      });
      return;
    }
    if (!target) {
      addIssue(collector, {
        code: "unknown-target-node",
        severity: "error",
        message: `Связь ведёт к отсутствующему блоку «${connection.to_block}».`,
        edgeId,
        scopePath,
      });
      return;
    }
    if (connection.from_block === connection.to_block) {
      addIssue(collector, {
        code: "self-connection",
        severity: "error",
        message: `Блок «${connection.from_block}» не может быть соединён сам с собой.`,
        nodeId: connection.from_block,
        edgeId,
        scopePath,
      });
      return;
    }

    const sourcePorts = expectedPorts.get(source.id)?.output ?? source.output_ports;
    const targetPorts = expectedPorts.get(target.id)?.input ?? target.input_ports;
    if (!sourcePorts.includes(connection.from_port)) {
      addIssue(collector, {
        code: "unknown-source-port",
        severity: "error",
        message: `У блока «${source.id}» нет выхода «${connection.from_port}».`,
        nodeId: source.id,
        edgeId,
        portId: connection.from_port,
        scopePath,
      });
      return;
    }
    if (!targetPorts.includes(connection.to_port)) {
      addIssue(collector, {
        code: "unknown-target-port",
        severity: "error",
        message: `У блока «${target.id}» нет входа «${connection.to_port}».`,
        nodeId: target.id,
        edgeId,
        portId: connection.to_port,
        scopePath,
      });
      return;
    }

    const exactKey = [
      connection.from_block,
      connection.from_port,
      connection.to_block,
      connection.to_port,
    ].join("\u0000");
    if (exactConnections.has(exactKey)) {
      addIssue(collector, {
        code: "duplicate-connection",
        severity: "error",
        message: "Эта связь уже существует.",
        edgeId,
        scopePath,
      });
      return;
    }
    exactConnections.add(exactKey);

    const inputKey = `${connection.to_block}\u0000${connection.to_port}`;
    const previousEdgeId = occupiedInputs.get(inputKey);
    if (previousEdgeId) {
      addIssue(collector, {
        code: "input-occupied",
        severity: "error",
        message: `Вход «${connection.to_block}.${connection.to_port}» имеет несколько источников.`,
        nodeId: connection.to_block,
        edgeId,
        portId: connection.to_port,
        scopePath,
      });
      return;
    }
    occupiedInputs.set(inputKey, edgeId);
    incoming.add(inputKey);
    outgoing.add(`${connection.from_block}\u0000${connection.from_port}`);
    validConnections.push({ connection, edgeId });
  });

  for (const [blockId, ports] of expectedPorts) {
    for (const port of ports.input) {
      if (!incoming.has(`${blockId}\u0000${port}`)) {
        addIssue(collector, {
          code: "required-input-unconnected",
          severity: "error",
          message: `Не подключён обязательный вход «${blockId}.${port}».`,
          nodeId: blockId,
          portId: port,
          scopePath,
        });
      }
    }
    for (const port of ports.output) {
      if (!outgoing.has(`${blockId}\u0000${port}`)) {
        addIssue(collector, {
          code: "output-unconnected",
          severity: "warning",
          message: `Выход «${blockId}.${port}» не используется.`,
          nodeId: blockId,
          portId: port,
          scopePath,
        });
      }
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const blockId of blocksById.keys()) {
    adjacency.set(blockId, []);
  }
  for (const { connection } of validConnections) {
    adjacency.get(connection.from_block)?.push(connection.to_block);
  }
  if (sources.length > 0 && outputs.length > 0) {
    const reached = reachableFrom(sources, adjacency);
    if (!outputs.some((outputId) => reached.has(outputId))) {
      addIssue(collector, {
        code: "missing-forward-path",
        severity: "error",
        message: "Нет непрерывного пути от входного сигнала к выходу.",
        scopePath,
      });
    }
  }

  analyzeFeedback(blocksById, validConnections, collector, scopePath);

  for (const block of diagram.blocks) {
    if (block.type !== "Subsystem") {
      continue;
    }
    const nested = block.parameters.diagram;
    if (
      isRecord(nested) &&
      Array.isArray(nested.blocks) &&
      Array.isArray(nested.connections)
    ) {
      analyzeLevel(
        nested as unknown as Diagram,
        collector,
        [...scopePath, block.id],
        true,
      );
    }
  }
}

function buildReport(issues: ModelDiagnosticIssue[]): ModelDiagnosticReport {
  const ordered = [...issues].sort(
    (left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity],
  );
  const counts: ModelDiagnosticCounts = { error: 0, warning: 0, info: 0 };
  for (const issue of ordered) {
    counts[issue.severity] += 1;
  }
  return {
    issues: ordered,
    counts,
    hasErrors: counts.error > 0,
    hasWarnings: counts.warning > 0,
    canRun: counts.error === 0,
  };
}

export function diagnoseDiagram(
  diagram: Diagram,
  options: DiagnoseDiagramOptions = {},
): ModelDiagnosticReport {
  const collector: Collector = {
    issues: [],
    nextOrdinal: 0,
    seenDiagrams: new WeakSet<object>(),
  };
  analyzeLevel(diagram, collector, [], false, options.edgeIds);
  if (!collector.issues.some((issue) => issue.severity === "error")) {
    addIssue(collector, {
      code: "model-ready",
      severity: "info",
      message: "Предварительная проверка пройдена: модель готова к расчёту.",
    });
  }
  return buildReport(collector.issues);
}

export function diagnoseFlowModel(
  nodes: readonly DiagnosticFlowNode[],
  edges: readonly DiagnosticFlowEdge[],
): ModelDiagnosticReport {
  const diagram: Diagram = {
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
  return diagnoseDiagram(diagram, { edgeIds: edges.map((edge) => edge.id) });
}

/** Readable alias for callers that operate on persisted Diagram objects. */
export const runModelDiagnostics = diagnoseDiagram;

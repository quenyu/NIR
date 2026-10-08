import {
  inputPortsFor,
  isBlockType,
  outputPortsFor,
  type Diagram,
  type DiagramBlock,
  type DiagramConnection,
} from "../types/diagram";

export const PROJECT_FORMAT = "nir-dynamics-project" as const;
export const PROJECT_VERSION = 1 as const;
export const MAX_PROJECT_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export type ProjectSolver = "rk4" | "solve_ivp";

export interface ProjectPosition {
  x: number;
  y: number;
}

export interface ProjectViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface ProjectSimulationSettings {
  solver: ProjectSolver;
  t_start: number;
  t_end: number;
  dt: number;
}

export interface DiagramProjectFile {
  format: typeof PROJECT_FORMAT;
  version: typeof PROJECT_VERSION;
  metadata: {
    title: string;
    exported_at: string;
    generator: string;
  };
  diagram: Diagram;
  layout: {
    positions: Record<string, ProjectPosition>;
    viewport?: ProjectViewport;
  };
  simulation: ProjectSimulationSettings;
}

export interface ParsedDiagramProject {
  project: DiagramProjectFile;
  warnings: string[];
}

export class ProjectFileError extends Error {
  public readonly details: string[];

  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = "ProjectFileError";
    this.details = details;
  }
}

type UnknownRecord = Record<string, unknown>;

const DEFAULT_SIMULATION: ProjectSimulationSettings = {
  solver: "solve_ivp",
  t_start: 0,
  t_end: 6,
  dt: 0.01,
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function asNonEmptyString(
  value: unknown,
  path: string,
  errors: string[],
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path}: ожидается непустая строка.`);
    return "";
  }
  return value.trim();
}

function asStringArray(
  value: unknown,
  path: string,
  errors: string[],
): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${path}: ожидается массив строк.`);
    return [];
  }

  const result: string[] = [];
  value.forEach((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      errors.push(`${path}[${index}]: ожидается непустая строка.`);
      return;
    }
    result.push(item.trim());
  });
  return result;
}

function validateJsonValue(
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      errors.push(`${path}: числовое значение должно быть конечным.`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateJsonValue(item, `${path}[${index}]`, errors),
    );
    return;
  }

  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      validateJsonValue(item, `${path}.${key}`, errors);
    }
    return;
  }

  errors.push(`${path}: неподдерживаемый тип значения.`);
}

function parseParameters(
  value: unknown,
  path: string,
  errors: string[],
): Record<string, unknown> {
  if (!isRecord(value)) {
    errors.push(`${path}: ожидается объект параметров.`);
    return {};
  }
  validateJsonValue(value, path, errors);
  return structuredClone(value);
}

function numericParameter(
  parameters: Record<string, unknown>,
  key: string,
  fallback: number,
  path: string,
  errors: string[],
): number {
  const raw = parameters[key] ?? fallback;
  if (typeof raw === "boolean") {
    errors.push(`${path}.${key}: ожидается число, а не логическое значение.`);
    return fallback;
  }
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed)) {
    errors.push(`${path}.${key}: ожидается конечное число.`);
    return fallback;
  }
  return parsed;
}

function numericVectorParameter(
  parameters: Record<string, unknown>,
  key: string,
  fallback: number[],
  path: string,
  errors: string[],
): number[] {
  const raw = parameters[key] ?? fallback;
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push(`${path}.${key}: ожидается непустой массив чисел.`);
    return fallback;
  }
  return raw.map((item, index) => {
    if (typeof item === "boolean") {
      errors.push(`${path}.${key}[${index}]: ожидается конечное число.`);
      return 0;
    }
    const parsed = typeof item === "number" ? item : Number(item);
    if (!Number.isFinite(parsed)) {
      errors.push(`${path}.${key}[${index}]: ожидается конечное число.`);
      return 0;
    }
    return parsed;
  });
}

function polynomialOrder(coefficients: number[]): number {
  const firstNonZero = coefficients.findIndex(
    (coefficient) => coefficient !== 0,
  );
  return firstNonZero < 0 ? 0 : coefficients.length - firstNonZero - 1;
}

function validateBlockParameters(
  type: DiagramBlock["type"],
  parameters: Record<string, unknown>,
  path: string,
  errors: string[],
): void {
  switch (type) {
    case "StepInput":
      numericParameter(parameters, "amplitude", 1, path, errors);
      numericParameter(parameters, "t0", 0, path, errors);
      break;
    case "Gain":
      numericParameter(parameters, "k", 1, path, errors);
      break;
    case "Integrator":
      numericParameter(parameters, "k", 1, path, errors);
      numericParameter(parameters, "y0", 0, path, errors);
      break;
    case "FirstOrderLag": {
      numericParameter(parameters, "k", 1, path, errors);
      const timeConstant = numericParameter(parameters, "T", 1, path, errors);
      numericParameter(parameters, "y0", 0, path, errors);
      if (timeConstant <= 0) {
        errors.push(`${path}.T: значение должно быть больше 0.`);
      }
      break;
    }
    case "SecondOrderOscillator": {
      numericParameter(parameters, "k", 1, path, errors);
      const naturalFrequency = numericParameter(
        parameters,
        "wn",
        1,
        path,
        errors,
      );
      const damping = numericParameter(parameters, "zeta", 0.2, path, errors);
      numericParameter(parameters, "y0", 0, path, errors);
      numericParameter(parameters, "v0", 0, path, errors);
      if (naturalFrequency <= 0) {
        errors.push(`${path}.wn: значение должно быть больше 0.`);
      }
      if (damping < 0) {
        errors.push(`${path}.zeta: значение должно быть не меньше 0.`);
      }
      break;
    }
    case "TransferFunction": {
      const numerator = numericVectorParameter(
        parameters,
        "numerator",
        [1],
        path,
        errors,
      );
      const denominator = numericVectorParameter(
        parameters,
        "denominator",
        [1, 1],
        path,
        errors,
      );
      if (denominator[0] === 0) {
        errors.push(`${path}.denominator[0]: значение не должно быть равно 0.`);
      } else if (polynomialOrder(numerator) > denominator.length - 1) {
        errors.push(
          `${path}.numerator: порядок числителя не должен превышать порядок знаменателя.`,
        );
      }
      break;
    }
    case "Sum": {
      const signs = parameters.signs;
      if (!Array.isArray(signs) || signs.length === 0) {
        errors.push(`${path}.signs: ожидается непустой массив знаков.`);
      } else if (signs.some((sign) => sign !== "+" && sign !== "-")) {
        errors.push(`${path}.signs: допустимы только знаки «+» и «-».`);
      }
      break;
    }
    case "ButterworthLPF": {
      const order = numericParameter(parameters, "order", 2, path, errors);
      const cutoff = numericParameter(
        parameters,
        "cutoff_freq",
        10,
        path,
        errors,
      );
      numericParameter(parameters, "y0", 0, path, errors);
      if (!Number.isInteger(order) || order < 1 || order > 10) {
        errors.push(`${path}.order: ожидается целое число от 1 до 10.`);
      }
      if (cutoff <= 0) {
        errors.push(`${path}.cutoff_freq: значение должно быть больше 0.`);
      }
      break;
    }
    case "PIDController": {
      numericParameter(parameters, "kp", 1, path, errors);
      numericParameter(parameters, "ki", 0, path, errors);
      numericParameter(parameters, "kd", 0, path, errors);
      const filterN = numericParameter(parameters, "filter_n", 20, path, errors);
      if (filterN <= 0) {
        errors.push(`${path}.filter_n: значение должно быть больше 0.`);
      }
      break;
    }
    case "Subsystem":
      parseDiagram(parameters.diagram, errors, `${path}.diagram`, true);
      break;
    case "SubsystemInput":
    case "SubsystemOutput":
      asNonEmptyString(parameters.port, `${path}.port`, errors);
      break;
    case "Scope":
      if (
        parameters.label !== undefined &&
        parameters.label !== null &&
        typeof parameters.label === "object"
      ) {
        errors.push(`${path}.label: ожидается строковое значение.`);
      }
      break;
  }
}

function parseBlocks(
  value: unknown,
  errors: string[],
  diagramPath: string,
  allowInterfaceBlocks: boolean,
): DiagramBlock[] {
  if (!Array.isArray(value)) {
    errors.push(`${diagramPath}.blocks: ожидается массив блоков.`);
    return [];
  }

  const blocks: DiagramBlock[] = [];
  const ids = new Set<string>();

  value.forEach((rawBlock, index) => {
    const path = `${diagramPath}.blocks[${index}]`;
    if (!isRecord(rawBlock)) {
      errors.push(`${path}: ожидается объект блока.`);
      return;
    }

    const id = asNonEmptyString(rawBlock.id, `${path}.id`, errors);
    const rawType = asNonEmptyString(rawBlock.type, `${path}.type`, errors);
    if (id && ids.has(id)) {
      errors.push(`${path}.id: дублирующийся идентификатор «${id}».`);
    }
    if (id) {
      ids.add(id);
    }

    if (!isBlockType(rawType)) {
      errors.push(
        `${path}.type: неизвестный тип блока «${rawType || "(пусто)"}».`,
      );
      return;
    }
    if (
      !allowInterfaceBlocks &&
      (rawType === "SubsystemInput" || rawType === "SubsystemOutput")
    ) {
      errors.push(`${path}.type: интерфейсный блок допустим только внутри Subsystem.`);
    }

    const parameters = parseParameters(
      rawBlock.parameters,
      `${path}.parameters`,
      errors,
    );
    validateBlockParameters(rawType, parameters, `${path}.parameters`, errors);
    const inputPorts = asStringArray(
      rawBlock.input_ports,
      `${path}.input_ports`,
      errors,
    );
    const outputPorts = asStringArray(
      rawBlock.output_ports,
      `${path}.output_ports`,
      errors,
    );

    const expectedInputs = inputPortsFor(rawType, parameters);
    const expectedOutputs = outputPortsFor(rawType, parameters);
    if (JSON.stringify(inputPorts) !== JSON.stringify(expectedInputs)) {
      errors.push(
        `${path}.input_ports: для блока ${rawType} ожидаются порты ${JSON.stringify(expectedInputs)}.`,
      );
    }
    if (JSON.stringify(outputPorts) !== JSON.stringify(expectedOutputs)) {
      errors.push(
        `${path}.output_ports: для блока ${rawType} ожидаются порты ${JSON.stringify(expectedOutputs)}.`,
      );
    }

    blocks.push({
      id,
      type: rawType,
      parameters,
      input_ports: inputPorts,
      output_ports: outputPorts,
    });
  });

  return blocks;
}

function parseConnections(
  value: unknown,
  blocks: DiagramBlock[],
  errors: string[],
  diagramPath: string,
): DiagramConnection[] {
  if (!Array.isArray(value)) {
    errors.push(`${diagramPath}.connections: ожидается массив связей.`);
    return [];
  }

  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  const occupiedInputs = new Set<string>();
  const connections: DiagramConnection[] = [];

  value.forEach((rawConnection, index) => {
    const path = `${diagramPath}.connections[${index}]`;
    if (!isRecord(rawConnection)) {
      errors.push(`${path}: ожидается объект связи.`);
      return;
    }

    const fromBlock = asNonEmptyString(
      rawConnection.from_block,
      `${path}.from_block`,
      errors,
    );
    const fromPort = asNonEmptyString(
      rawConnection.from_port,
      `${path}.from_port`,
      errors,
    );
    const toBlock = asNonEmptyString(
      rawConnection.to_block,
      `${path}.to_block`,
      errors,
    );
    const toPort = asNonEmptyString(
      rawConnection.to_port,
      `${path}.to_port`,
      errors,
    );

    const source = blocksById.get(fromBlock);
    const target = blocksById.get(toBlock);
    if (!source) {
      errors.push(`${path}.from_block: блок «${fromBlock}» не найден.`);
    } else if (!source.output_ports.includes(fromPort)) {
      errors.push(
        `${path}.from_port: порт «${fromPort}» отсутствует у блока «${fromBlock}».`,
      );
    }
    if (!target) {
      errors.push(`${path}.to_block: блок «${toBlock}» не найден.`);
    } else if (!target.input_ports.includes(toPort)) {
      errors.push(
        `${path}.to_port: порт «${toPort}» отсутствует у блока «${toBlock}».`,
      );
    }

    const inputKey = `${toBlock}\u0000${toPort}`;
    if (occupiedInputs.has(inputKey)) {
      errors.push(
        `${path}: вход «${toBlock}.${toPort}» уже занят другой связью.`,
      );
    }
    occupiedInputs.add(inputKey);

    connections.push({
      from_block: fromBlock,
      from_port: fromPort,
      to_block: toBlock,
      to_port: toPort,
    });
  });

  return connections;
}

function parseDiagram(
  value: unknown,
  errors: string[],
  path = "diagram",
  allowInterfaceBlocks = false,
): Diagram {
  if (!isRecord(value)) {
    errors.push(`${path}: ожидается объект схемы.`);
    return { blocks: [], connections: [] };
  }
  const blocks = parseBlocks(value.blocks, errors, path, allowInterfaceBlocks);
  const connections = parseConnections(value.connections, blocks, errors, path);
  const connectedInputs = new Set(
    connections.map((connection) => `${connection.to_block}\u0000${connection.to_port}`),
  );
  for (const block of blocks) {
    for (const port of block.input_ports) {
      if (!connectedInputs.has(`${block.id}\u0000${port}`)) {
        errors.push(`${path}: обязательный вход «${block.id}.${port}» не подключен.`);
      }
    }
  }
  if (allowInterfaceBlocks) {
    for (const interfaceType of ["SubsystemInput", "SubsystemOutput"] as const) {
      const ports = blocks
        .filter((block) => block.type === interfaceType)
        .map((block) => String(block.parameters.port ?? "").trim())
        .filter(Boolean);
      if (new Set(ports).size !== ports.length) {
        errors.push(`${path}: имена портов ${interfaceType} должны быть уникальными.`);
      }
    }
  }
  return { blocks, connections };
}

function parsePosition(
  value: unknown,
  path: string,
  errors: string[],
): ProjectPosition | null {
  if (!isRecord(value)) {
    errors.push(`${path}: ожидается объект с координатами x и y.`);
    return null;
  }
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    errors.push(`${path}: координаты x и y должны быть конечными числами.`);
    return null;
  }
  return { x: value.x, y: value.y };
}

function fallbackPosition(index: number): ProjectPosition {
  return { x: 80 + (index % 3) * 220, y: 100 + Math.floor(index / 3) * 130 };
}

function parsePositions(
  value: unknown,
  blocks: DiagramBlock[],
  errors: string[],
  warnings: string[],
): Record<string, ProjectPosition> {
  if (value === undefined) {
    warnings.push(
      "В файле не было координат блоков; применена автоматическая раскладка.",
    );
    return Object.fromEntries(
      blocks.map((block, index) => [block.id, fallbackPosition(index)]),
    );
  }
  if (!isRecord(value)) {
    errors.push("layout.positions: ожидается объект координат.");
    return {};
  }

  const result: Record<string, ProjectPosition> = {};
  const blockIds = new Set(blocks.map((block) => block.id));
  blocks.forEach((block, index) => {
    const rawPosition = value[block.id];
    if (rawPosition === undefined) {
      result[block.id] = fallbackPosition(index);
      warnings.push(
        `Для блока «${block.id}» не было координат; применена автоматическая позиция.`,
      );
      return;
    }

    const parsed = parsePosition(
      rawPosition,
      `layout.positions.${block.id}`,
      errors,
    );
    if (parsed) {
      result[block.id] = parsed;
    }
  });

  for (const key of Object.keys(value)) {
    if (!blockIds.has(key)) {
      warnings.push(`Координаты неизвестного блока «${key}» проигнорированы.`);
    }
  }
  return result;
}

function parseViewport(
  value: unknown,
  errors: string[],
): ProjectViewport | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    errors.push("layout.viewport: ожидается объект x/y/zoom.");
    return undefined;
  }
  if (
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y) ||
    !isFiniteNumber(value.zoom)
  ) {
    errors.push("layout.viewport: x, y и zoom должны быть конечными числами.");
    return undefined;
  }
  if (value.zoom <= 0 || value.zoom > 8) {
    errors.push(
      "layout.viewport.zoom: значение должно быть больше 0 и не превышать 8.",
    );
    return undefined;
  }
  return { x: value.x, y: value.y, zoom: value.zoom };
}

function parseSimulation(
  value: unknown,
  errors: string[],
  warnings: string[],
): ProjectSimulationSettings {
  if (value === undefined) {
    warnings.push(
      "Параметры моделирования отсутствовали; использованы значения по умолчанию.",
    );
    return { ...DEFAULT_SIMULATION };
  }
  if (!isRecord(value)) {
    errors.push("simulation: ожидается объект параметров моделирования.");
    return { ...DEFAULT_SIMULATION };
  }
  if (
    value.solver === undefined &&
    value.t_start === undefined &&
    value.t_end === undefined &&
    value.dt === undefined
  ) {
    warnings.push(
      "Параметры моделирования отсутствовали; использованы значения по умолчанию.",
    );
    return { ...DEFAULT_SIMULATION };
  }

  const solver = value.solver;
  const tStart = value.t_start;
  const tEnd = value.t_end;
  const dt = value.dt;

  if (solver !== "rk4" && solver !== "solve_ivp") {
    errors.push("simulation.solver: допустимы только «rk4» и «solve_ivp».");
  }
  if (!isFiniteNumber(tStart)) {
    errors.push("simulation.t_start: ожидается конечное число.");
  }
  if (!isFiniteNumber(tEnd) || tEnd <= 0) {
    errors.push("simulation.t_end: значение должно быть конечным и больше 0.");
  }
  if (!isFiniteNumber(dt) || dt <= 0) {
    errors.push("simulation.dt: значение должно быть конечным и больше 0.");
  }
  if (isFiniteNumber(tStart) && isFiniteNumber(tEnd) && tEnd <= tStart) {
    errors.push("simulation: t_end должно быть больше t_start.");
  }

  return {
    solver: solver === "rk4" ? "rk4" : "solve_ivp",
    t_start: isFiniteNumber(tStart) ? tStart : DEFAULT_SIMULATION.t_start,
    t_end: isFiniteNumber(tEnd) ? tEnd : DEFAULT_SIMULATION.t_end,
    dt: isFiniteNumber(dt) ? dt : DEFAULT_SIMULATION.dt,
  };
}

function parseMetadata(value: unknown): DiagramProjectFile["metadata"] {
  if (!isRecord(value)) {
    return {
      title: "Импортированная схема",
      exported_at: new Date().toISOString(),
      generator: "unknown",
    };
  }
  return {
    title:
      typeof value.title === "string" && value.title.trim()
        ? value.title.trim()
        : "Импортированная схема",
    exported_at:
      typeof value.exported_at === "string" && value.exported_at.trim()
        ? value.exported_at.trim()
        : new Date().toISOString(),
    generator:
      typeof value.generator === "string" && value.generator.trim()
        ? value.generator.trim()
        : "unknown",
  };
}

function finalizeProject(
  project: DiagramProjectFile,
  errors: string[],
  warnings: string[],
): ParsedDiagramProject {
  if (errors.length > 0) {
    throw new ProjectFileError(
      "Файл схемы содержит ошибки и не был загружен.",
      errors,
    );
  }
  return { project, warnings };
}

export function parseDiagramProjectJson(text: string): ParsedDiagramProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "неизвестная ошибка JSON";
    throw new ProjectFileError("Не удалось прочитать JSON-файл.", [reason]);
  }

  if (!isRecord(raw)) {
    throw new ProjectFileError("Корневой элемент JSON должен быть объектом.");
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  if (raw.format === PROJECT_FORMAT) {
    if (raw.version !== PROJECT_VERSION) {
      errors.push(
        `version: версия «${String(raw.version)}» не поддерживается; ожидается ${PROJECT_VERSION}.`,
      );
    }
    const diagram = parseDiagram(raw.diagram, errors);
    const layout = isRecord(raw.layout) ? raw.layout : {};
    if (raw.layout !== undefined && !isRecord(raw.layout)) {
      errors.push("layout: ожидается объект.");
    }
    const positions = parsePositions(
      layout.positions,
      diagram.blocks,
      errors,
      warnings,
    );
    const viewport = parseViewport(layout.viewport, errors);
    const simulation = parseSimulation(raw.simulation, errors, warnings);

    return finalizeProject(
      {
        format: PROJECT_FORMAT,
        version: PROJECT_VERSION,
        metadata: parseMetadata(raw.metadata),
        diagram,
        layout: { positions, ...(viewport ? { viewport } : {}) },
        simulation,
      },
      errors,
      warnings,
    );
  }

  const legacyDiagram = isRecord(raw.diagram) ? raw.diagram : raw;
  const diagram = parseDiagram(legacyDiagram, errors);
  warnings.push(
    "Загружен совместимый файл старого формата. При следующем сохранении он будет преобразован в формат проекта версии 1.",
  );
  const positions = parsePositions(undefined, diagram.blocks, errors, warnings);
  const simulation = isRecord(raw.diagram)
    ? parseSimulation(raw, errors, warnings)
    : { ...DEFAULT_SIMULATION };

  return finalizeProject(
    {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      metadata: {
        title: "Импортированная схема",
        exported_at: new Date().toISOString(),
        generator: "legacy-json",
      },
      diagram,
      layout: { positions },
      simulation,
    },
    errors,
    warnings,
  );
}

export function createDiagramProject(args: {
  title?: string;
  diagram: Diagram;
  positions: Record<string, ProjectPosition>;
  viewport?: ProjectViewport;
  simulation: ProjectSimulationSettings;
}): DiagramProjectFile {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    metadata: {
      title: args.title?.trim() || "Структурная схема",
      exported_at: new Date().toISOString(),
      generator: "NIR Dynamics Web Prototype",
    },
    diagram: structuredClone(args.diagram),
    layout: {
      positions: structuredClone(args.positions),
      ...(args.viewport ? { viewport: { ...args.viewport } } : {}),
    },
    simulation: { ...args.simulation },
  };
}

export function serializeDiagramProject(project: DiagramProjectFile): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

export function buildProjectFilename(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    [
      "diagram",
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      `${pad(date.getHours())}-${pad(date.getMinutes())}`,
    ].join("_") + ".json"
  );
}

export function downloadDiagramProject(
  project: DiagramProjectFile,
  filename?: string,
): void {
  const blob = new Blob([serializeDiagramProject(project)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename ?? buildProjectFilename();
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

import type {
  SimulationMetadata,
  SimulationModelProvenance,
  SimulationResponse,
  SimulationStateMappingEntry,
} from "../../types/api";
import { UiIcon } from "../UiIcon";

function formatResidual(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return Math.abs(value) < 0.001 ? value.toExponential(2) : value.toPrecision(4);
}

function getModelProvenance(metadata: SimulationMetadata): SimulationModelProvenance | null {
  const value = metadata.provenance;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as SimulationModelProvenance
    : null;
}

function getStateMapping(metadata: SimulationMetadata): SimulationStateMappingEntry[] {
  const provenance = getModelProvenance(metadata);
  if (Array.isArray(provenance?.state_mapping)) {
    return provenance.state_mapping;
  }
  return Array.isArray(metadata.state_mapping) ? metadata.state_mapping : [];
}

function formatSubsystemPath(path: string | string[] | undefined): string | null {
  if (Array.isArray(path)) {
    return path.filter(Boolean).join(" / ") || null;
  }
  return path?.trim() || null;
}

function MatrixTable({
  name,
  values,
  meaning,
  rowLabels,
  columnLabels,
}: {
  name: "A" | "B" | "C" | "D";
  values: number[][];
  meaning: string;
  rowLabels: string[];
  columnLabels: string[];
}) {
  const columns = values[0]?.length ?? 0;
  return (
    <article className="matrix-card" data-testid={`matrix-card-${name}`}>
      <header>
        <div>
          <strong>{name}</strong>
          <small>{meaning}</small>
        </div>
        <span>{values.length} × {columns}</span>
      </header>
      {values.length === 0 || columns === 0 ? (
        <p>Пустая матрица</p>
      ) : (
        <div className="matrix-table-wrap">
          <table className="matrix-table">
            <caption className="visually-hidden">Матрица {name}: {meaning}</caption>
            <thead>
              <tr>
                <th scope="col" aria-label="Координаты" />
                {Array.from({ length: columns }, (_, columnIndex) => (
                  <th scope="col" key={`${name}-column-${columnIndex}`} title={columnLabels[columnIndex]}>
                    {columnLabels[columnIndex] || `c${columnIndex + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {values.map((row, rowIndex) => (
                <tr key={`${name}-row-${rowIndex}`}>
                  <th scope="row" title={rowLabels[rowIndex]}>
                    {rowLabels[rowIndex] || `r${rowIndex + 1}`}
                  </th>
                  {row.map((value, columnIndex) => (
                    <td key={`${name}-${rowIndex}-${columnIndex}`}>
                      {Math.abs(value) < 1e-12 ? "0" : Number(value.toPrecision(6)).toString()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

export function StateSpacePanel({ result }: { result: SimulationResponse | null }) {
  const system = result?.system_analysis;
  if (!result?.success || !system) {
    return <p>Матрицы станут доступны после моделирования корректной схемы.</p>;
  }

  const provenance = getModelProvenance(result.metadata);
  const stateMapping = getStateMapping(result.metadata);
  const indexBase = provenance?.index_base ?? 0;
  const matrixDimensions = provenance?.matrix_dimensions;
  const loops = system.algebraic_loops ?? [];

  return (
    <div className="state-space-view">
      <header className="state-space-view__header">
        <div className="state-space-view__identity">
          <span><UiIcon name="activity" /> Непрерывная LTI-модель</span>
          <strong>ẋ = Ax + Bu · y = Cx + Du</strong>
        </div>
        <dl aria-label="Размерность модели">
          <div><dt>Состояния</dt><dd>{system.state_dimension}</dd></div>
          <div><dt>Входы</dt><dd>{system.input_dimension}</dd></div>
          <div><dt>Выходы</dt><dd>{system.output_dimension}</dd></div>
        </dl>
      </header>
      <section className="state-space-section matrix-section" aria-labelledby="matrix-section-title">
        <header className="state-space-section__header">
          <div>
            <UiIcon name="table" />
            <div>
              <h3 id="matrix-section-title">Матрицы системы</h3>
              <p>Строки и столбцы подписаны координатами собранной модели.</p>
            </div>
          </div>
          <span>A · B · C · D</span>
        </header>
        <div className="matrix-grid">
          <MatrixTable
            name="A"
            values={system.matrices.A}
            meaning={matrixDimensions?.A?.explanation ?? "n × n · динамика состояний"}
            rowLabels={system.state_labels}
            columnLabels={system.state_labels}
          />
          <MatrixTable
            name="B"
            values={system.matrices.B}
            meaning={matrixDimensions?.B?.explanation ?? "n × m · влияние входов"}
            rowLabels={system.state_labels}
            columnLabels={system.input_blocks}
          />
          <MatrixTable
            name="C"
            values={system.matrices.C}
            meaning={matrixDimensions?.C?.explanation ?? "p × n · формирование выходов"}
            rowLabels={system.output_labels}
            columnLabels={system.state_labels}
          />
          <MatrixTable
            name="D"
            values={system.matrices.D}
            meaning={matrixDimensions?.D?.explanation ?? "p × m · прямая передача"}
            rowLabels={system.output_labels}
            columnLabels={system.input_blocks}
          />
        </div>
      </section>
      {loops.length > 0 && (
        <article className="model-verification-card is-verified" data-testid="algebraic-loops">
          <div className="model-verification-card__status" aria-hidden="true">
            <UiIcon name="info" />
          </div>
          <div className="model-verification-card__copy">
            <span>Алгебраические петли</span>
            <strong>Решены при сборке: (I − D·M)·y = C·x + D·N·r</strong>
            <small>{loops.map((loop) => loop.blocks.join(" → ")).join("; ")}</small>
          </div>
          <dl className="model-verification-card__metrics">
            <div><dt>κ max</dt><dd>{formatResidual(Math.max(...loops.map((loop) => loop.condition_number)))}</dd></div>
          </dl>
        </article>
      )}
      <section className="model-provenance" data-testid="model-provenance">
        <header>
          <div className="model-provenance__title">
            <UiIcon name="database" />
            <div>
              <h3>Как собрана модель</h3>
              <p>Координаты x связаны с динамическими блоками исходной схемы.</p>
            </div>
          </div>
          <span>{stateMapping.length > 0 ? `${stateMapping.length} состояний` : "Нет provenance"}</span>
        </header>
        {system.state_dimension === 0 ? (
          <p className="model-provenance__empty">Статическая модель не содержит состояний.</p>
        ) : (
          <div className="model-provenance__table-wrap">
            <table className="model-provenance__table">
              <thead>
                <tr>
                  <th scope="col">Координата</th>
                  <th scope="col">Состояние</th>
                  <th scope="col">Блок</th>
                  <th scope="col">Подсистема</th>
                </tr>
              </thead>
              <tbody>
              {Array.from({ length: system.state_dimension }, (_, stateIndex) => {
              const source = stateMapping.find((entry) => (
                (entry.global_index ?? entry.state_index ?? entry.index) === stateIndex + indexBase
              )) ?? stateMapping[stateIndex];
              const nestedSource = source?.source && typeof source.source === "object"
                ? source.source
                : source?.provenance && typeof source.provenance === "object"
                  ? source.provenance
                  : null;
              const blockId = source?.block_id
                ?? source?.local_block_id
                ?? nestedSource?.block_id
                ?? nestedSource?.local_block_id;
              const blockType = source?.block_type ?? nestedSource?.block_type;
              const subsystem = formatSubsystemPath(
                source?.subsystem_path
                  ?? source?.source_subsystem_path
                  ?? nestedSource?.subsystem_path
                  ?? nestedSource?.source_subsystem_path,
              );
              const label = source?.label
                ?? source?.state_label
                ?? system.state_labels[stateIndex]
                ?? `Состояние ${stateIndex + 1}`;
              return (
                <tr key={stateIndex} data-testid={`state-source-x${stateIndex + 1}`}>
                  <td><code>x<sub>{stateIndex + 1}</sub></code></td>
                  <td><strong>{label}</strong></td>
                  <td>
                    {blockId
                      ? <><code>{blockId}</code>{blockType && <small>{blockType}</small>}</>
                      : <span className="is-unavailable">Не указан</span>}
                  </td>
                  <td>{subsystem || <span className="is-unavailable">Корневая схема</span>}</td>
                </tr>
              );
              })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <dl className="state-space-labels" aria-label="Обозначения модели">
        <div><dt>χ(s)</dt><dd>{system.characteristic_polynomial.map((value) => Number(value.toPrecision(6))).join(", ")}</dd></div>
        <div><dt>x</dt><dd>{system.state_labels.join(", ") || "—"}</dd></div>
        <div><dt>u</dt><dd>{system.input_blocks.join(", ") || "—"}</dd></div>
        <div><dt>y</dt><dd>{system.output_labels.join(", ") || "—"}</dd></div>
      </dl>
    </div>
  );
}

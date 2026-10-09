import { blockTypeLabel, type BlockNodeData } from "../../types/diagram";
import { russianCountNoun } from "../../features/modelingWorkspace";
import { UiIcon } from "../UiIcon";

export type InspectorView = "block" | "simulation";

interface WorkspaceInspectorProps {
  selectedNode: BlockNodeData | null;
  selectedNodeId: string | null;
  selectedNodeTitle: string;
  currentLevelTitle: string;
  info: string;
  view: InspectorView;
  onViewChange: (view: InspectorView) => void;
  onClose: () => void;
  solver: "rk4" | "solve_ivp";
  onSolverChange: (solver: "rk4" | "solve_ivp") => void;
  tEnd: number;
  onTEndChange: (value: number) => void;
  dt: number;
  onDtChange: (value: number) => void;
  onValidate: () => void;
  onOpenParameters: () => void;
  onDeleteSelected: () => void;
  onEnterSubsystem: (nodeId: string) => void;
  nodeCount: number;
  edgeCount: number;
  hierarchyDepth: number;
}

export function WorkspaceInspector({
  selectedNode,
  selectedNodeId,
  selectedNodeTitle,
  currentLevelTitle,
  info,
  view,
  onViewChange,
  onClose,
  solver,
  onSolverChange,
  tEnd,
  onTEndChange,
  dt,
  onDtChange,
  onValidate,
  onOpenParameters,
  onDeleteSelected,
  onEnterSubsystem,
  nodeCount,
  edgeCount,
  hierarchyDepth,
}: WorkspaceInspectorProps) {
  return (
    <aside className="inspector-pane inspector-pane--context is-open" aria-label="Инспектор модели">
      <header className="context-pane__header">
        <div className="context-pane__title">
          <span>{selectedNode ? "Контекст блока" : "Контекст схемы"}</span>
          <strong>{selectedNode ? selectedNodeTitle : currentLevelTitle}</strong>
        </div>
        <button type="button" className="panel-close-button" onClick={onClose} aria-label="Закрыть инспектор" title="Закрыть инспектор">
          <UiIcon name="close" />
        </button>
        <nav className="context-pane__tabs" aria-label="Содержимое правой панели" role="tablist">
          <button type="button" role="tab" aria-selected={view === "block"} className={view === "block" ? "is-active" : ""} onClick={() => onViewChange("block")} disabled={!selectedNode}>
            <UiIcon name="settings" />
            Блок
          </button>
          <button type="button" role="tab" aria-selected={view === "simulation"} className={view === "simulation" ? "is-active" : ""} onClick={() => onViewChange("simulation")}>
            <UiIcon name="activity" />
            Расчёт
          </button>
        </nav>
      </header>

      {info && !selectedNode && <p className="context-pane__notice" data-testid="project-info"><UiIcon name="check" />{info}</p>}

      <div className="context-pane__content">
        {view === "simulation" ? (
          <section className="panel inspector-panel context-panel" role="tabpanel">
            <header className="panel-heading">
              <div><span className="panel-kicker">Расчёт</span><h2>Параметры модели</h2></div>
              <UiIcon name="activity" />
            </header>
            <div className="simulation-form">
              <label className="tool-input tool-input--wide">
                <span>Численный метод</span>
                <select value={solver} onChange={(event) => onSolverChange(event.target.value as "rk4" | "solve_ivp")} data-testid="solver-select">
                  <option value="solve_ivp">Adaptive RK45 · solve_ivp</option>
                  <option value="rk4">Fixed step · RK4</option>
                </select>
              </label>
              <div className="simulation-form__row">
                <label className="tool-input"><span>Интервал, t_end</span><span className="field-with-unit"><input type="number" value={tEnd} onChange={(event) => onTEndChange(Number(event.target.value))} /><small>с</small></span></label>
                <label className="tool-input"><span>Шаг, dt</span><span className="field-with-unit"><input type="number" value={dt} step="0.001" onChange={(event) => onDtChange(Number(event.target.value))} /><small>с</small></span></label>
              </div>
            </div>
            <button type="button" className="btn btn-secondary btn-full" onClick={onValidate} data-testid="validate-button"><UiIcon name="check" />Проверить структуру</button>
            <details className="context-help">
              <summary><UiIcon name="info" /> Замкнутый контур</summary>
              <ol>
                <li>Задание подключите к положительному входу Sum.</li>
                <li>Выход объекта верните на отрицательный вход.</li>
                <li>Между ошибкой и объектом установите регулятор.</li>
                <li>Scope подключите к выходному сигналу.</li>
              </ol>
            </details>
          </section>
        ) : (
          <section className="panel inspector-panel selection-panel context-panel" role="tabpanel">
            {selectedNode ? (
              <div className="selection-card">
                <span className="selection-card__type">{blockTypeLabel(selectedNode.blockType)}</span>
                <strong title={selectedNodeTitle}>{selectedNodeTitle}</strong>
                <p>{Object.keys(selectedNode.parameters).length} параметров · {selectedNode.inputPorts.length} входов · {selectedNode.outputPorts.length} выходов</p>
                {selectedNode.blockType === "Subsystem" && (
                  <>
                    <small>Внутренняя схема открывается на этом же холсте отдельным уровнем.</small>
                  </>
                )}
              </div>
            ) : (
              <div className="inspector-empty"><span><UiIcon name="info" /></span><p>Выберите блок на рабочем поле, чтобы открыть его свойства.</p></div>
            )}
            <div className="inspector-actions">
              {selectedNode?.blockType === "Subsystem" && (
                <button type="button" className="btn btn-primary" onClick={() => onEnterSubsystem(selectedNode.blockId)} data-testid="open-subsystem-button"><UiIcon name="folder" />Открыть уровень</button>
              )}
              <button type="button" className="btn btn-secondary" onClick={onOpenParameters} disabled={!selectedNodeId}><UiIcon name="settings" />Параметры</button>
              <button type="button" className="btn btn-danger-soft" onClick={onDeleteSelected} disabled={!selectedNodeId}><UiIcon name="trash" />Удалить</button>
            </div>
          </section>
        )}
      </div>

      <footer className="context-pane__status">
        <span><strong>{nodeCount}</strong> {russianCountNoun(nodeCount, "блок", "блока", "блоков")}</span>
        <span><strong>{edgeCount}</strong> {russianCountNoun(edgeCount, "связь", "связи", "связей")}</span>
        <span><strong>{hierarchyDepth}</strong> {russianCountNoun(hierarchyDepth, "уровень", "уровня", "уровней")}</span>
        <span><strong>{solver === "solve_ivp" ? "RK45" : "RK4"}</strong> solver</span>
      </footer>
    </aside>
  );
}

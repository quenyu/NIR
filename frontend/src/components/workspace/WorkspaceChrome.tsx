import { useEffect, useRef, type ChangeEvent } from "react";
import type { DiagnosticsRunState } from "../DiagnosticsPanel";
import { formatRussianCount } from "../../features/modelingWorkspace";
import { UiIcon } from "../UiIcon";

interface WorkspaceChromeProps {
  diagnosticsState: DiagnosticsRunState;
  simulationSucceeded: boolean;
  runDisabled: boolean;
  runButtonLabel: string;
  onRun: () => void;
  onSaveProject: () => void;
  onImportProject: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  isArranging: boolean;
  canArrange: boolean;
  onArrange: () => void;
  projectTitle: string;
  nodeCount: number;
  edgeCount: number;
  serverProjectId: string | null;
  serverProjectVersion: number | null;
  onSaveServerProject: () => void;
  onOpenServerProjects: () => void;
  onClear: () => void;
}

function statusLabel(state: DiagnosticsRunState, simulationSucceeded: boolean): string {
  if (state === "validating") return "Проверка схемы";
  if (state === "running") return "Идёт расчёт";
  if (state === "error") return "Нужно исправление";
  if (state === "success") return simulationSucceeded ? "Расчёт завершён" : "Схема проверена";
  return "Проект готов";
}

export function WorkspaceChrome({
  diagnosticsState,
  simulationSucceeded,
  runDisabled,
  runButtonLabel,
  onRun,
  onSaveProject,
  onImportProject,
  isArranging,
  canArrange,
  onArrange,
  projectTitle,
  nodeCount,
  edgeCount,
  serverProjectId,
  serverProjectVersion,
  onSaveServerProject,
  onOpenServerProjects,
  onClear,
}: WorkspaceChromeProps) {
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const commandMenuRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    function closeCommandMenu() {
      commandMenuRef.current?.removeAttribute("open");
    }

    function onPointerDown(event: PointerEvent) {
      const menu = commandMenuRef.current;
      const target = event.target;
      if (menu?.open && target instanceof window.Node && !menu.contains(target)) {
        closeCommandMenu();
      }
    }

    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeCommandMenu();
    }

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onEscape);
    };
  }, []);

  function closeMenuAnd(action: () => void) {
    commandMenuRef.current?.removeAttribute("open");
    action();
  }

  return (
    <header className="app-header focus-header">
      <div className="app-brand">
        <span className="app-brand__mark" aria-hidden="true">△</span>
        <div><strong>CONTROL LAB</strong><span>DYNAMIC SYSTEMS</span></div>
      </div>


      <div className="header-project" title={projectTitle || "Линейная непрерывная модель"}>
        <span>~/models/current</span>
        <strong>{projectTitle || "Линейная модель"}</strong>
        <small data-testid="diagram-stats">{formatRussianCount(nodeCount, "блок", "блока", "блоков")} · {formatRussianCount(edgeCount, "связь", "связи", "связей")}</small>
      </div>

      <div className="header-actions" aria-label="Команды проекта">
        <input ref={importFileInputRef} type="file" accept="application/json,.json" className="visually-hidden" onChange={(event) => void onImportProject(event)} data-testid="project-file-input" />
        <div className="app-header__status" title={statusLabel(diagnosticsState, simulationSucceeded)} role="status" aria-live="polite">
          <span className={`status-dot ${diagnosticsState === "error" ? "is-error" : diagnosticsState === "success" ? "is-ready" : ""}`} />
          <span>{statusLabel(diagnosticsState, simulationSucceeded)}</span>
        </div>

        <button type="button" className="header-save-button" onClick={onSaveProject} data-testid="save-project-button" title="Сохранить проект в JSON" aria-label="Сохранить проект">
          <UiIcon name="save" />
        </button>

        <button type="button" className="btn btn-primary btn-run" onClick={onRun} data-testid="simulate-button" disabled={runDisabled}>
          <UiIcon name="play" /><span>{runButtonLabel}</span><span aria-hidden="true">→</span>
        </button>

        <details ref={commandMenuRef} className="command-menu">
          <summary aria-label="Дополнительные команды" title="Дополнительные команды"><UiIcon name="more" /></summary>
          <div className="command-menu__popover">
            <span className="command-menu__label">Файл и схема</span>
            <button type="button" onClick={() => closeMenuAnd(() => importFileInputRef.current?.click())} data-testid="load-project-button">
              <UiIcon name="folder" /><span><strong>Открыть JSON</strong><small>Загрузить локальный проект</small></span>
            </button>
            <button type="button" onClick={() => closeMenuAnd(onArrange)} disabled={isArranging || !canArrange} data-testid="arrange-diagram-button">
              <UiIcon name="arrange" /><span><strong>{isArranging ? "Раскладка…" : "Разложить схему"}</strong><small>Автоматическое размещение блоков</small></span>
            </button>
            <span className="command-menu__separator" />
            <span className="command-menu__label">Серверные проекты</span>
            <button type="button" onClick={() => closeMenuAnd(onSaveServerProject)} data-testid="save-server-project-button">
              <UiIcon name="save" />
              <span><strong>{serverProjectId ? "Обновить на сервере" : "Сохранить на сервере"}</strong><small>{serverProjectId ? `Текущая версия: ${serverProjectVersion}` : "Создать серверную копию"}</small></span>
            </button>
            <button type="button" onClick={() => closeMenuAnd(onOpenServerProjects)} data-testid="open-server-projects-button">
              <UiIcon name="archive" /><span><strong>Открыть проекты</strong><small>Список серверных версий</small></span>
            </button>
            <span className="command-menu__separator" />
            <button type="button" className="is-danger" onClick={() => closeMenuAnd(onClear)} data-testid="clear-button">
              <UiIcon name="trash" /><span><strong>Очистить поле</strong><small>Удалить все блоки и связи</small></span>
            </button>
          </div>
        </details>
      </div>
    </header>
  );
}

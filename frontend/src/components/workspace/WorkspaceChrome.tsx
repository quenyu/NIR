import { useEffect, useRef, type ChangeEvent } from "react";
import type { DiagnosticsRunState } from "../DiagnosticsPanel";
import { UiIcon } from "../UiIcon";
import { ScrambleText } from "../../features/motion/ScrambleText";

export interface HierarchyCrumb {
  depth: number;
  label: string;
}

interface WorkspaceChromeProps {
  diagnosticsState: DiagnosticsRunState;
  simulationSucceeded: boolean;
  runDisabled: boolean;
  onRun: () => void;
  onExportProject: () => void;
  onImportProject: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  projectTitle: string;
  hierarchy: HierarchyCrumb[];
  onLeaveToDepth: (depth: number) => void;
  isLibraryOpen: boolean;
  onToggleLibrary: () => void;
  onOpenCommands: () => void;
  serverProjectId: string | null;
  serverProjectVersion: number | null;
  onSaveServerProject: () => void;
  onOpenServerProjects: () => void;
  onClear: () => void;
}

/** The one place where the run state is named. */
export function statusLabel(state: DiagnosticsRunState, simulationSucceeded: boolean): string {
  if (state === "validating") return "Проверка схемы";
  if (state === "running") return "Расчёт";
  if (state === "error") return "Нужно исправление";
  if (state === "success") return simulationSucceeded ? "Расчёт завершён" : "Схема корректна";
  return "Готово к расчёту";
}

export function WorkspaceChrome({
  diagnosticsState,
  simulationSucceeded,
  runDisabled,
  onRun,
  onExportProject,
  onImportProject,
  projectTitle,
  hierarchy,
  onLeaveToDepth,
  isLibraryOpen,
  onToggleLibrary,
  onOpenCommands,
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
      if (menu?.open && target instanceof window.Node && !menu.contains(target)) closeCommandMenu();
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

  const busy = diagnosticsState === "validating" || diagnosticsState === "running";
  const depth = hierarchy.length - 1;
  const status = statusLabel(diagnosticsState, simulationSucceeded);

  return (
    <header className="hud-header">
      <div className="hud-header__left">
        <div className="hud-brand">
          <ScrambleText className="hud-key" text="Control Lab" />
          <span className="hud-brand__project" title={projectTitle || "Проект не сохранён на сервере"}>
            {projectTitle || "Новая схема"}
          </span>
        </div>
        {depth > 0 && (
          <nav className="hud-crumbs" aria-label="Уровень подсистемы">
            <button
              type="button"
              className="hud-crumbs__up"
              onClick={() => onLeaveToDepth(depth - 1)}
              data-testid="leave-subsystem-button"
              aria-label="На уровень выше"
              title="На уровень выше (Esc)"
            >
              ←
            </button>
            {hierarchy.map((part) => (
              <button
                key={`${part.depth}-${part.label}`}
                type="button"
                className={part.depth === depth ? "is-current" : ""}
                onClick={() => onLeaveToDepth(part.depth)}
                disabled={part.depth === depth}
              >
                {part.label}
              </button>
            ))}
          </nav>
        )}
      </div>

      <div className="hud-header__right">
        <span className={`hud-status is-${diagnosticsState}`} role="status" aria-live="polite" data-testid="run-status">
          <span className="hud-status__dot" aria-hidden="true" />
          <ScrambleText text={status} />
        </span>
        <button type="button" className="hud-link" onClick={onToggleLibrary} aria-pressed={isLibraryOpen} title="Библиотека блоков (B)">
          Блоки
        </button>
        <button type="button" className="hud-link" onClick={onOpenCommands} title="Команды (Ctrl+K)" data-testid="open-commands-button">
          Команды <kbd>Ctrl K</kbd>
        </button>
        <button
          type="button"
          className="hud-link"
          onClick={onSaveServerProject}
          data-testid="save-server-project-button"
          title={serverProjectId ? `Сохранить на сервере (Ctrl+S) · версия ${serverProjectVersion}` : "Сохранить на сервере (Ctrl+S)"}
        >
          Сохранить
        </button>
        <input ref={importFileInputRef} type="file" accept="application/json,.json" className="visually-hidden" onChange={(event) => void onImportProject(event)} data-testid="project-file-input" />
        <details ref={commandMenuRef} className="hud-menu">
          <summary aria-label="Дополнительные команды" title="Дополнительные команды"><UiIcon name="more" /></summary>
          <div className="hud-menu__popover">
            <button type="button" onClick={() => closeMenuAnd(onOpenServerProjects)} data-testid="open-server-projects-button">Проекты на сервере</button>
            <button type="button" onClick={() => closeMenuAnd(() => importFileInputRef.current?.click())} data-testid="load-project-button">Импорт JSON</button>
            <button type="button" onClick={() => closeMenuAnd(onExportProject)} data-testid="save-project-button">Экспорт JSON</button>
            <span className="hud-menu__separator" />
            <button
              type="button"
              className="is-danger"
              onClick={() => closeMenuAnd(() => {
                if (window.confirm("Удалить все блоки и связи?")) onClear();
              })}
              data-testid="clear-button"
            >
              Очистить поле
            </button>
          </div>
        </details>
        <button type="button" className={`hud-run ${busy ? "is-busy" : ""}`} onClick={onRun} data-testid="simulate-button" disabled={runDisabled} title="Запустить (Ctrl+Enter)">
          <span className="hud-orbit" aria-hidden="true"><span /></span>
          {busy ? "Расчёт…" : "Запустить"}
        </button>
      </div>
    </header>
  );
}

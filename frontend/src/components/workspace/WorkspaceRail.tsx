import type { DiagnosticsRunState } from "../DiagnosticsPanel";
import { UiIcon } from "../UiIcon";

interface WorkspaceRailProps {
  diagnosticsState: DiagnosticsRunState;
  simulationSucceeded: boolean;
  isLibraryOpen: boolean;
  isInspectorOpen: boolean;
  isScopeOpen: boolean;
  isArranging: boolean;
  canArrange: boolean;
  onToggleLibrary: () => void;
  onOpenInspector: () => void;
  onToggleScope: () => void;
  onArrange: () => void;
  onFit: () => void;
}

function stateLabel(state: DiagnosticsRunState, simulationSucceeded: boolean): string {
  if (state === "validating") return "Проверка модели";
  if (state === "running") return "Моделирование";
  if (state === "error") return "Есть ошибки";
  if (state === "success") return simulationSucceeded ? "Расчёт готов" : "Схема корректна";
  return "Система готова";
}

export function WorkspaceRail({
  diagnosticsState,
  simulationSucceeded,
  isLibraryOpen,
  isInspectorOpen,
  isScopeOpen,
  isArranging,
  canArrange,
  onToggleLibrary,
  onOpenInspector,
  onToggleScope,
  onArrange,
  onFit,
}: WorkspaceRailProps) {
  const currentState = stateLabel(diagnosticsState, simulationSucceeded);

  return (
    <nav className="mission-rail" aria-label="Инструменты рабочего пространства">
      <div className="mission-rail__mode" aria-hidden="true">
        <span>SYS</span>
        <strong>AX</strong>
      </div>

      <div className="mission-rail__tools">
        <button
          type="button"
          className={isLibraryOpen ? "is-active" : ""}
          onClick={onToggleLibrary}
          aria-expanded={isLibraryOpen}
          aria-label="Блоки"
          data-testid="toggle-block-library"
        >
          <UiIcon name="blocks" />
          <span>Библиотека</span>
        </button>
        <button type="button" onClick={onArrange} disabled={isArranging || !canArrange}>
          <UiIcon name="arrange" />
          <span>{isArranging ? "Раскладка…" : "Разложить"}</span>
        </button>
        <button type="button" onClick={onFit}>
          <UiIcon name="fit" />
          <span>Показать целиком</span>
        </button>
        <span className="mission-rail__separator" />
        <button
          type="button"
          className={isInspectorOpen ? "is-active" : ""}
          onClick={onOpenInspector}
          aria-expanded={isInspectorOpen}
          aria-label="Расчёт"
        >
          <UiIcon name="settings" />
          <span>Параметры расчёта</span>
        </button>
        <button
          type="button"
          className={isScopeOpen ? "is-active" : ""}
          onClick={onToggleScope}
          aria-expanded={isScopeOpen}
        >
          <UiIcon name="activity" />
          <span>{simulationSucceeded ? "Результаты" : "Диагностика"}</span>
        </button>
        <a href="/experiments">
          <UiIcon name="flask" />
          <span>Эксперименты</span>
        </a>
      </div>

      <div className={`mission-rail__state is-${diagnosticsState}`} title={currentState}>
        <span />
        <small>SYS</small>
      </div>
    </nav>
  );
}

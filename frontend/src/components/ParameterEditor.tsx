import { useEffect, useState } from "react";
import { blockTypeLabel, type BlockNodeData } from "../types/diagram";

interface ParameterEditorProps {
  open: boolean;
  selectedNode: BlockNodeData | null;
  onClose: () => void;
  onParametersApply: (updates: Record<string, unknown>) => void;
}

function formatParameterValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(",");
  }
  if (value === undefined || value === null) {
    return "";
  }
  return String(value);
}

function parseParameterValue(key: string, raw: string): unknown {
  if (key === "signs") {
    const parsed = raw
      .split(",")
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    return parsed.length > 0 ? parsed : ["+", "-"];
  }

  const asNumber = Number(raw);
  if (raw.trim().length > 0 && Number.isFinite(asNumber)) {
    return asNumber;
  }
  return raw;
}

export function ParameterEditor({
  open,
  selectedNode,
  onClose,
  onParametersApply
}: ParameterEditorProps) {
  const [draft, setDraft] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!selectedNode) {
      setDraft({});
      return;
    }
    setDraft({ ...selectedNode.parameters });
  }, [selectedNode]);

  if (!open) {
    return null;
  }

  if (!selectedNode) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="parameter-modal" onClick={(event) => event.stopPropagation()}>
          <header className="parameter-modal__header">
            <h2>Параметры блока</h2>
            <button type="button" className="btn" onClick={onClose}>
              Закрыть
            </button>
          </header>
          <p>Сначала выберите блок на рабочем поле.</p>
        </div>
      </div>
    );
  }

  function updateDraft(key: string, raw: string) {
    setDraft((current) => ({ ...current, [key]: parseParameterValue(key, raw) }));
  }

  function applyChanges() {
    onParametersApply(draft);
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <section
          className="parameter-modal"
          onClick={(event) => event.stopPropagation()}
          data-testid="parameter-modal"
      >
        <header className="parameter-modal__header">
          <div>
            <h2>Параметры блока</h2>
            <p>
              <strong>{blockTypeLabel(selectedNode.blockType)}</strong> ({selectedNode.blockId})
            </p>
          </div>
          <button type="button" className="btn" onClick={onClose}>
            Закрыть
          </button>
        </header>

        <div className="parameter-list">
          {Object.entries(draft).map(([key, value]) => (
            <label key={`${selectedNode.blockId}-${key}`} className="parameter-item">
              <span>{key}</span>
              <input
                value={formatParameterValue(value)}
                onChange={(event) => updateDraft(key, event.target.value)}
                data-testid={`param-${selectedNode.blockId}-${key}`}
              />
            </label>
          ))}
        </div>

        <div className="parameter-modal__actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={applyChanges}
            data-testid="apply-params-button"
          >
            Применить
          </button>
        </div>
      </section>
    </div>
  );
}

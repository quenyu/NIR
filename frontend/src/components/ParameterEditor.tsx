import { useEffect, useState } from "react";
import { blockTypeLabel, normalizedSigns, type BlockNodeData } from "../types/diagram";

interface ParameterEditorProps {
  open: boolean;
  selectedNode: BlockNodeData | null;
  connectedInputPorts?: string[];
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

  if (key === "numerator" || key === "denominator") {
    return raw
      .split(",")
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
      .map((token) => {
        const value = Number(token);
        return Number.isFinite(value) ? value : token;
      });
  }

  const asNumber = Number(raw);
  if (raw.trim().length > 0 && Number.isFinite(asNumber)) {
    return asNumber;
  }
  return raw;
}

function sumPortIndex(portName: string): number | null {
  const match = /^in(\d+)$/.exec(portName);
  if (!match) {
    return null;
  }
  return Number(match[1]) - 1;
}

export function ParameterEditor({
  open,
  selectedNode,
  connectedInputPorts = [],
  onClose,
  onParametersApply
}: ParameterEditorProps) {
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [localMessage, setLocalMessage] = useState<string>("");

  useEffect(() => {
    if (!selectedNode) {
      setDraft({});
      return;
    }
    setDraft({ ...selectedNode.parameters });
    setLocalMessage("");
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

  function updateSigns(nextSigns: string[]) {
    setLocalMessage("");
    setDraft((current) => ({ ...current, signs: nextSigns }));
  }

  function toggleSign(index: number) {
    const signs = normalizedSigns(draft.signs);
    const nextSigns = signs.map((sign, currentIndex) =>
      currentIndex === index ? (sign === "+" ? "-" : "+") : sign
    );
    updateSigns(nextSigns);
  }

  function addSumInput() {
    updateSigns([...normalizedSigns(draft.signs), "+"]);
  }

  function blockedPortForSumInputRemoval(index: number): string | undefined {
    return connectedInputPorts.find((portName) => {
      const connectedIndex = sumPortIndex(portName);
      return connectedIndex !== null && connectedIndex >= index;
    });
  }

  function removeSumInput(index: number) {
    const blockedPort = blockedPortForSumInputRemoval(index);
    if (blockedPort) {
      setLocalMessage(
        `Нельзя удалить вход Sum.${blockedPort}: к нему подключена связь.`
      );
      return;
    }
    const nextSigns = normalizedSigns(draft.signs).filter(
      (_, currentIndex) => currentIndex !== index
    );
    updateSigns(nextSigns.length > 0 ? nextSigns : ["+"]);
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
          {Object.entries(draft).map(([key, value]) => {
            if (selectedNode.blockType === "Sum" && key === "signs") {
              const signs = normalizedSigns(value);
              return (
                <div key={`${selectedNode.blockId}-${key}`} className="parameter-item">
                  <span>{key}</span>
                  <div className="sum-sign-editor">
                    <div className="sum-sign-editor__header">
                      <span>Порт</span>
                      <span>Знак</span>
                      <span>Действие</span>
                    </div>
                    {signs.map((sign, index) => (
                      <div key={`${selectedNode.blockId}-sign-${index}`} className="sum-sign-row">
                        <span>{`in${index + 1}`}</span>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => toggleSign(index)}
                          data-testid={`sum-sign-${selectedNode.blockId}-${index}`}
                          title={`Сменить знак ${selectedNode.blockId}.in${index + 1}`}
                        >
                          {sign}
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger-soft"
                          onClick={() => removeSumInput(index)}
                          disabled={signs.length <= 1}
                          title={
                            blockedPortForSumInputRemoval(index)
                              ? "Сначала удалите связь с этим или последующим входом"
                              : "Удалить вход"
                          }
                        >
                          Удалить
                        </button>
                      </div>
                    ))}
                    <button type="button" className="btn" onClick={addSumInput}>
                      Добавить вход
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <label key={`${selectedNode.blockId}-${key}`} className="parameter-item">
                <span>{key}</span>
                <input
                  value={formatParameterValue(value)}
                  onChange={(event) => updateDraft(key, event.target.value)}
                  data-testid={`param-${selectedNode.blockId}-${key}`}
                />
              </label>
            );
          })}
        </div>

        {localMessage && <p className="parameter-warning">{localMessage}</p>}

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

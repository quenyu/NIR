import { useEffect, useState } from "react";
import { blockTypeLabel, normalizedSigns, type BlockNodeData } from "../types/diagram";
import { UiIcon } from "./UiIcon";
import { useDialogFocus } from "../hooks/useDialogFocus";

interface ParameterEditorProps {
  open: boolean;
  selectedNode: BlockNodeData | null;
  connectedInputPorts?: string[];
  onClose: () => void;
  onParametersApply: (updates: Record<string, unknown>) => void;
}

const PARAMETER_LABELS: Record<string, string> = {
  amplitude: "Амплитуда",
  t0: "Момент начала, с",
  k: "Коэффициент усиления K",
  T: "Постоянная времени T",
  y0: "Начальное значение y₀",
  v0: "Начальная скорость v₀",
  wn: "Собственная частота ωₙ",
  zeta: "Коэффициент затухания ζ",
  numerator: "Числитель",
  denominator: "Знаменатель",
  order: "Порядок фильтра",
  cutoff_freq: "Частота среза, рад/с",
  kp: "Пропорциональный коэффициент Kₚ",
  ki: "Интегральный коэффициент Kᵢ",
  kd: "Дифференциальный коэффициент Kd",
  filter_n: "Частота фильтра производной N",
  name: "Название блока",
  label: "Имя сигнала",
  reference: "Заданное значение r",
  signs: "Входы сумматора",
  port: "Имя внешнего порта",
};

function parameterLabel(key: string): string {
  return PARAMETER_LABELS[key] ?? key;
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
  const dialogRef = useDialogFocus<HTMLElement>(open, onClose);

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
        <section ref={dialogRef} className="parameter-modal" role="dialog" aria-modal="true" aria-labelledby="parameter-modal-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
          <header className="parameter-modal__header">
            <div>
              <span className="panel-kicker">Инспектор модели</span>
              <h2 id="parameter-modal-title">Параметры блока</h2>
            </div>
            <button type="button" className="btn" onClick={onClose}>
              <UiIcon name="close" />
              Закрыть
            </button>
          </header>
          <p>Сначала выберите блок на рабочем поле.</p>
        </section>
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
          ref={dialogRef}
          className="parameter-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="parameter-modal-title"
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
          data-testid="parameter-modal"
      >
        <header className="parameter-modal__header">
          <div>
            <span className="panel-kicker">Инспектор модели</span>
            <h2 id="parameter-modal-title">Параметры блока</h2>
            <p>
              <strong>{blockTypeLabel(selectedNode.blockType)}</strong> ({selectedNode.blockId})
            </p>
          </div>
          <button type="button" className="btn" onClick={onClose}>
            <UiIcon name="close" />
            Закрыть
          </button>
        </header>

        <div className="parameter-list">
          {selectedNode.blockType === "Subsystem" && (
            <div className="parameter-item subsystem-parameter-summary">
              <span>Вложенная схема</span>
              <p>Содержимое редактируется кнопкой «Открыть подсистему» в инспекторе.</p>
            </div>
          )}
          {Object.entries(draft).filter(([key]) => key !== "diagram" && key !== "layout").map(([key, value]) => {
            if (selectedNode.blockType === "Sum" && key === "signs") {
              const signs = normalizedSigns(value);
              return (
                <div key={`${selectedNode.blockId}-${key}`} className="parameter-item">
                  <span>{parameterLabel(key)}</span>
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
                <span>{parameterLabel(key)}</span>
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
            <UiIcon name="check" />
            Применить
          </button>
        </div>
      </section>
    </div>
  );
}

import { useEffect, useState, type KeyboardEvent } from "react";
import { blockTypeLabel, normalizedSigns, type BlockNodeData } from "../../types/diagram";
import { UiIcon } from "../UiIcon";

interface WorkspaceInspectorProps {
  node: BlockNodeData;
  title: string;
  connectedInputPorts: string[];
  onParametersApply: (updates: Record<string, unknown>) => void;
  onDelete: () => void;
  onEnterSubsystem: (nodeId: string) => void;
  onClose: () => void;
}

const PARAMETER_LABELS: Record<string, string> = {
  amplitude: "Амплитуда A",
  t0: "Момент начала t₀, с",
  k: "Коэффициент K",
  T: "Постоянная времени T, с",
  y0: "Начальное значение y₀",
  v0: "Начальная скорость v₀",
  wn: "Собственная частота ω₀",
  zeta: "Затухание ζ",
  numerator: "Числитель N(s)",
  denominator: "Знаменатель D(s)",
  order: "Порядок n",
  cutoff_freq: "Частота среза ωc, рад/с",
  kp: "Kp",
  ki: "Ki",
  kd: "Kd",
  filter_n: "Фильтр производной N",
  name: "Название",
  label: "Имя сигнала",
  reference: "Задание r",
  port: "Имя порта",
};

const HIDDEN_PARAMETERS = new Set(["diagram", "layout", "signs"]);

function formatParameterValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  if (value === undefined || value === null) return "";
  return String(value);
}

function parseParameterValue(key: string, raw: string): unknown {
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
  if (raw.trim().length > 0 && Number.isFinite(asNumber)) return asNumber;
  return raw;
}

function sumPortIndex(portName: string): number | null {
  const match = /^in(\d+)$/.exec(portName);
  return match ? Number(match[1]) - 1 : null;
}

/** Parameters of the selected block, edited in place: a field applies on Enter or when it loses focus. */
export function WorkspaceInspector({
  node,
  title,
  connectedInputPorts,
  onParametersApply,
  onDelete,
  onEnterSubsystem,
  onClose,
}: WorkspaceInspectorProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  useEffect(() => {
    setDrafts({});
    setMessage("");
  }, [node.blockId]);

  const fields = Object.entries(node.parameters).filter(([key]) => !HIDDEN_PARAMETERS.has(key));

  function commit(key: string) {
    const raw = drafts[key];
    if (raw === undefined) return;
    setDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    if (raw !== formatParameterValue(node.parameters[key])) {
      onParametersApply({ [key]: parseParameterValue(key, raw) });
    }
  }

  function onFieldKey(event: KeyboardEvent<HTMLInputElement>, key: string) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(key);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  const signs = node.blockType === "Sum" ? normalizedSigns(node.parameters.signs) : [];

  function setSigns(next: string[]) {
    setMessage("");
    onParametersApply({ signs: next });
  }

  function removeSumInput(index: number) {
    const blocked = connectedInputPorts.find((port) => {
      const connected = sumPortIndex(port);
      return connected !== null && connected >= index;
    });
    if (blocked) {
      setMessage(`Нельзя удалить вход ${blocked}: к нему или следующему входу подключена связь.`);
      return;
    }
    const next = signs.filter((_, current) => current !== index);
    setSigns(next.length > 0 ? next : ["+"]);
  }

  return (
    <aside className="hud-inspector" aria-label="Параметры блока" data-testid="block-inspector">
      <header className="hud-inspector__header">
        <div>
          <span className="hud-key">{blockTypeLabel(node.blockType)}</span>
          <strong title={title}>{title}</strong>
          {title !== node.blockId && <span className="hud-inspector__id">{node.blockId}</span>}
        </div>
        <button type="button" className="hud-icon-button" onClick={onClose} aria-label="Закрыть параметры" title="Закрыть (Esc)">
          <UiIcon name="close" />
        </button>
      </header>
      <div className="hud-hairline" />

      <div className="hud-inspector__fields">
        {node.blockType === "Subsystem" && (
          <p className="hud-note">Вложенная схема открывается на этом же холсте как отдельный уровень.</p>
        )}
        {fields.map(([key, value]) => (
          <label key={`${node.blockId}-${key}`} className="hud-field">
            <span className="hud-key">{PARAMETER_LABELS[key] ?? key}</span>
            <input
              value={drafts[key] ?? formatParameterValue(value)}
              onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
              onBlur={() => commit(key)}
              onKeyDown={(event) => onFieldKey(event, key)}
              data-testid={`param-${node.blockId}-${key}`}
              spellCheck={false}
            />
          </label>
        ))}

        {node.blockType === "Sum" && (
          <div className="hud-field">
            <span className="hud-key">Входы сумматора</span>
            <div className="hud-signs">
              {signs.map((sign, index) => (
                <div key={`${node.blockId}-sign-${index}`} className="hud-signs__row">
                  <span>in{index + 1}</span>
                  <button
                    type="button"
                    className="hud-sign"
                    onClick={() => setSigns(signs.map((current, i) => (i === index ? (current === "+" ? "-" : "+") : current)))}
                    data-testid={`sum-sign-${node.blockId}-${index}`}
                    title={`Сменить знак in${index + 1}`}
                  >
                    {sign === "-" ? "−" : "+"}
                  </button>
                  <button type="button" className="hud-link" onClick={() => removeSumInput(index)} disabled={signs.length <= 1}>
                    Удалить
                  </button>
                </div>
              ))}
              <button type="button" className="hud-link" onClick={() => setSigns([...signs, "+"])}>+ Добавить вход</button>
            </div>
          </div>
        )}
        {message && <p className="hud-note is-warning" role="alert">{message}</p>}
      </div>

      <div className="hud-inspector__actions">
        {node.blockType === "Subsystem" && (
          <button type="button" className="hud-button" onClick={() => onEnterSubsystem(node.blockId)} data-testid="open-subsystem-button">
            Открыть уровень
          </button>
        )}
        <button type="button" className="hud-link is-danger" onClick={onDelete} title="Удалить блок (Delete)">
          Удалить блок
        </button>
      </div>
    </aside>
  );
}

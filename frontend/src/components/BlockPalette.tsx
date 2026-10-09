import { useDeferredValue, useMemo, useState, type DragEvent } from "react";
import { blockTypeLabel, type BlockType } from "../types/diagram";
import { UiIcon } from "./UiIcon";

interface BlockPaletteProps {
  onAddBlock: (type: BlockType) => void;
  insideSubsystem?: boolean;
}

const BLOCK_GROUPS: Array<{
  title: string;
  items: Array<{ type: BlockType; symbol: string; formula: string; hint: string; label?: string }>;
}> = [
  {
    title: "Источники",
    items: [{ type: "StepInput", symbol: "u(t)", formula: "A · 1(t)", hint: "Ступенчатое воздействие заданной амплитуды" }],
  },
  {
    title: "Операции",
    items: [
      { type: "Gain", symbol: "K", formula: "y = Kx", hint: "Статическое усиление входного сигнала" },
      { type: "Sum", symbol: "Σ", formula: "y = Σ sᵢxᵢ", hint: "Суммирование и организация обратной связи" },
    ],
  },
  {
    title: "Динамика",
    items: [
      { type: "Integrator", symbol: "1/s", formula: "y = ∫u dt", hint: "Интегрирующее динамическое звено" },
      { type: "FirstOrderLag", symbol: "1°", formula: "K / (Ts + 1)", hint: "Апериодическое звено первого порядка" },
      { type: "SecondOrderOscillator", symbol: "2°", formula: "Kω₀² / D(s)", hint: "Колебательное звено второго порядка" },
      { type: "TransferFunction", symbol: "W(s)", label: "Передаточная ф-я", formula: "N(s) / D(s)", hint: "Произвольная передаточная функция" },
      { type: "ButterworthLPF", symbol: "LPF", formula: "H(s), n ≥ 1", hint: "Фильтр нижних частот Баттерворта" },
    ],
  },
  {
    title: "Управление",
    items: [
      { type: "PIDController", symbol: "PID", formula: "Kp + Ki/s + Kd·s", hint: "P, PI, PD или PID-регулятор" },
      { type: "Subsystem", symbol: "SUB", formula: "n IN → m OUT", hint: "Иерархическая подсистема отдельного уровня" },
    ],
  },
  {
    title: "Наблюдение",
    items: [{ type: "Scope", symbol: "y(t)", formula: "signal → plot", hint: "Регистрация и отображение выходного сигнала" }],
  },
];

export function BlockPalette({ onAddBlock, insideSubsystem = false }: BlockPaletteProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase("ru"));
  const groups = useMemo(() => insideSubsystem
    ? [
        ...BLOCK_GROUPS,
        {
          title: "Интерфейс подсистемы",
          items: [
            { type: "SubsystemInput" as const, symbol: "IN", formula: "external → level", hint: "Внешний вход текущего уровня" },
            { type: "SubsystemOutput" as const, symbol: "OUT", formula: "level → external", hint: "Внешний выход текущего уровня" },
          ],
        },
      ]
    : BLOCK_GROUPS, [insideSubsystem]);
  const visibleGroups = useMemo(() => {
    if (!deferredQuery) return groups;
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter(({ type, formula, hint, label }) =>
          [blockTypeLabel(type), label, formula, hint, type]
            .filter(Boolean)
            .some((value) => String(value).toLocaleLowerCase("ru").includes(deferredQuery)),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [deferredQuery, groups]);
  function handleDragStart(event: DragEvent<HTMLButtonElement>, type: BlockType) {
    event.dataTransfer.setData("application/nir-block-type", type);
    event.dataTransfer.effectAllowed = "move";
  }

  return (
    <section className="panel panel--flush block-library">
      <label className="palette-search">
        <span className="visually-hidden">Поиск блока</span>
        <UiIcon name="search" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по имени или формуле"
          autoComplete="off"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label="Очистить поиск">
            <UiIcon name="close" />
          </button>
        )}
      </label>
      <p className="panel-hint">Перетащите блок на схему или добавьте нажатием.</p>
      <div className="palette-list">
        {visibleGroups.map((group) => (
          <section className="palette-group" key={group.title}>
            <h3>{group.title}</h3>
            <div className="palette-group__items">
              {group.items.map(({ type, symbol, formula, hint, label }) => (
                <button
                  key={type}
                  type="button"
                  className="palette-item"
                  draggable
                  onDragStart={(event) => handleDragStart(event, type)}
                  onClick={() => onAddBlock(type)}
                  data-testid={`palette-${type}`}
                  title={`${blockTypeLabel(type)} — ${hint}`}
                >
                  <span className="palette-item__symbol">{symbol}</span>
                  <span className="palette-item__copy">
                    <strong>{label ?? blockTypeLabel(type)}</strong>
                    <small className="palette-item__formula">{formula}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {visibleGroups.length === 0 && (
          <div className="palette-empty" role="status">
            <strong>Совпадений нет</strong>
            <span>Измените запрос или очистите поиск.</span>
          </div>
        )}
      </div>
    </section>
  );
}

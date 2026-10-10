import { Command } from "cmdk";
import { useEffect } from "react";
import { blockTypeLabel, type BlockType } from "../types/diagram";

export interface PaletteAction {
  id: string;
  title: string;
  hint?: string;
  shortcut?: string;
  disabled?: boolean;
  run: () => void;
}

export interface PaletteExample {
  id: string;
  title: string;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  actions: PaletteAction[];
  blockTypes: Array<{ type: BlockType; symbol: string }>;
  onAddBlock: (type: BlockType) => void;
  examples: PaletteExample[];
  onOpenExample: (id: string) => void;
}

/** Ctrl+K: every block, example and command in one searchable list. */
export function CommandPalette({ open, onClose, actions, blockTypes, onAddBlock, examples, onOpenExample }: CommandPaletteProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  function choose(action: () => void) {
    onClose();
    action();
  }

  return (
    <div className="hud-overlay" onMouseDown={onClose}>
      <div className="hud-palette" role="dialog" aria-modal="true" aria-label="Команды" onMouseDown={(event) => event.stopPropagation()} data-testid="command-palette">
        <Command label="Команды" loop>
          <div className="hud-palette__search">
            <span className="hud-key">Поиск</span>
            <Command.Input autoFocus placeholder="Блок, пример или команда" data-testid="command-input" />
            <kbd>Esc</kbd>
          </div>
          <Command.List className="hud-palette__list">
            <Command.Empty className="hud-palette__empty">Ничего не найдено</Command.Empty>
            <Command.Group heading="Команды">
              {actions.map((action, index) => (
                <Command.Item
                  key={action.id}
                  value={`${action.title} ${action.hint ?? ""}`}
                  disabled={action.disabled}
                  onSelect={() => choose(action.run)}
                  style={{ ["--stagger" as string]: index }}
                >
                  <span className="hud-palette__glyph">›</span>
                  <span>{action.title}{action.hint && <span className="hud-palette__hint"> · {action.hint}</span>}</span>
                  {action.shortcut && <kbd>{action.shortcut}</kbd>}
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading="Добавить блок">
              {blockTypes.map(({ type, symbol }) => (
                <Command.Item key={type} value={`блок ${blockTypeLabel(type)} ${symbol} ${type}`} onSelect={() => choose(() => onAddBlock(type))} data-testid={`command-block-${type}`}>
                  <span className="hud-palette__glyph">{symbol}</span>
                  <span>{blockTypeLabel(type)}</span>
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading="Примеры">
              {examples.map((example) => (
                <Command.Item key={example.id} value={`пример ${example.title}`} onSelect={() => choose(() => onOpenExample(example.id))} data-testid={`load-example-${example.id}`}>
                  <span className="hud-palette__glyph">▣</span>
                  <span>{example.title}</span>
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

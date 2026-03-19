import type { DragEvent } from "react";
import { BLOCK_TYPES, blockTypeLabel, type BlockType } from "../types/diagram";

interface BlockPaletteProps {
  onAddBlock: (type: BlockType) => void;
}

export function BlockPalette({ onAddBlock }: BlockPaletteProps) {
  function handleDragStart(event: DragEvent<HTMLButtonElement>, type: BlockType) {
    event.dataTransfer.setData("application/nir-block-type", type);
    event.dataTransfer.effectAllowed = "move";
  }

  return (
    <section className="panel">
      <h2>Палитра блоков</h2>
      <p className="panel-hint">Нажмите для добавления или перетащите на рабочее поле.</p>
      <div className="palette-list">
        {BLOCK_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className="palette-item"
            draggable
            onDragStart={(event) => handleDragStart(event, type)}
            onClick={() => onAddBlock(type)}
            data-testid={`palette-${type}`}
          >
            {blockTypeLabel(type)}
          </button>
        ))}
      </div>
    </section>
  );
}

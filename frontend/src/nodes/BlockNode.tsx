import { Handle, Position, type NodeProps } from "reactflow";
import { blockTypeLabel, type BlockNodeData } from "../types/diagram";

function verticalOffset(index: number, count: number): string {
    const ratio = (index + 1) / (count + 1);
    return `${ratio * 100}%`;
}

export function BlockNode({ data }: NodeProps<BlockNodeData>) {
    return (
        <div
            className="block-node"
            data-testid={`node-${data.blockId}`}
            data-block-type={data.blockType}
        >
            {data.inputPorts.map((port, index) => (
                <Handle
                    key={`${data.blockId}-${port}`}
                    id={port}
                    type="target"
                    position={Position.Left}
                    style={{ top: verticalOffset(index, data.inputPorts.length) }}
                />
            ))}

      <div className="block-node__title">{blockTypeLabel(data.blockType)}</div>
      <div className="block-node__id">{data.blockId}</div>
      <div className="block-node__ports">
        вх:{data.inputPorts.length} / вых:{data.outputPorts.length}
      </div>

            {data.outputPorts.map((port, index) => (
                <Handle
                    key={`${data.blockId}-${port}`}
                    id={port}
                    type="source"
                    position={Position.Right}
                    style={{ top: verticalOffset(index, data.outputPorts.length) }}
                />
            ))}
        </div>
    );
}

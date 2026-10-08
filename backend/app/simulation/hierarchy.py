from __future__ import annotations

from dataclasses import dataclass, field

from app.models.diagram import Block, Connection, Diagram

Endpoint = tuple[str, str]


@dataclass
class DiagramExpansion:
    blocks: list[Block] = field(default_factory=list)
    connections: list[Connection] = field(default_factory=list)
    input_targets: dict[str, list[Endpoint]] = field(default_factory=dict)
    output_sources: dict[str, Endpoint] = field(default_factory=dict)


def _port_name(block: Block) -> str:
    return str(block.parameters.get("port", "")).strip()


def _prefix_id(prefix: str, block_id: str) -> str:
    return f"{prefix}{block_id}" if prefix else block_id


def _nested_diagram(block: Block) -> Diagram:
    raw = block.parameters.get("diagram")
    if not isinstance(raw, dict):
        raise ValueError(f"Подсистема '{block.id}' не содержит вложенную схему.")
    return Diagram.model_validate(raw)


def _expand_level(diagram: Diagram, prefix: str) -> DiagramExpansion:
    expansion = DiagramExpansion()
    blocks_by_id = {block.id: block for block in diagram.blocks}
    child_expansions: dict[str, DiagramExpansion] = {}

    for block in diagram.blocks:
        if block.type == "Subsystem":
            child = _expand_level(_nested_diagram(block), f"{prefix}{block.id}::")
            child_expansions[block.id] = child
            expansion.blocks.extend(child.blocks)
            expansion.connections.extend(child.connections)
        elif block.type not in {"SubsystemInput", "SubsystemOutput"}:
            copied = block.model_copy(deep=True)
            copied.id = _prefix_id(prefix, block.id)
            expansion.blocks.append(copied)

    def source_endpoint(block_id: str, port: str) -> Endpoint | None:
        block = blocks_by_id[block_id]
        if block.type == "SubsystemInput":
            return None
        if block.type == "Subsystem":
            source = child_expansions[block_id].output_sources.get(port)
            if source is None:
                raise ValueError(
                    f"Подсистема '{block_id}' не формирует выходной порт '{port}'."
                )
            return source
        return (_prefix_id(prefix, block_id), port)

    def target_endpoints(block_id: str, port: str) -> list[Endpoint] | None:
        block = blocks_by_id[block_id]
        if block.type == "SubsystemOutput":
            return None
        if block.type == "Subsystem":
            targets = child_expansions[block_id].input_targets.get(port)
            if not targets:
                raise ValueError(
                    f"Подсистема '{block_id}' не использует входной порт '{port}'."
                )
            return targets
        return [(_prefix_id(prefix, block_id), port)]

    for connection in diagram.connections:
        source_block = blocks_by_id[connection.from_block]
        target_block = blocks_by_id[connection.to_block]
        source = source_endpoint(connection.from_block, connection.from_port)
        targets = target_endpoints(connection.to_block, connection.to_port)

        if source_block.type == "SubsystemInput":
            input_port = _port_name(source_block)
            if targets is None:
                raise ValueError(
                    f"Прямое соединение входа '{input_port}' с выходом подсистемы "
                    "пока не поддерживается; добавьте промежуточный блок Gain с K=1."
                )
            expansion.input_targets.setdefault(input_port, []).extend(targets)
            continue

        if source is None:
            raise ValueError("Не удалось разрешить источник вложенного соединения.")

        if target_block.type == "SubsystemOutput":
            output_port = _port_name(target_block)
            if output_port in expansion.output_sources:
                raise ValueError(
                    f"Выходной порт подсистемы '{output_port}' имеет несколько источников."
                )
            expansion.output_sources[output_port] = source
            continue

        if targets is None:
            raise ValueError("Не удалось разрешить приёмник вложенного соединения.")
        for target in targets:
            expansion.connections.append(
                Connection(
                    from_block=source[0],
                    from_port=source[1],
                    to_block=target[0],
                    to_port=target[1],
                )
            )

    interface_inputs = [
        _port_name(block) for block in diagram.blocks if block.type == "SubsystemInput"
    ]
    interface_outputs = [
        _port_name(block) for block in diagram.blocks if block.type == "SubsystemOutput"
    ]
    if len(set(interface_inputs)) != len(interface_inputs):
        raise ValueError("Имена входных портов подсистемы должны быть уникальными.")
    if len(set(interface_outputs)) != len(interface_outputs):
        raise ValueError("Имена выходных портов подсистемы должны быть уникальными.")
    for port in interface_inputs:
        if not expansion.input_targets.get(port):
            raise ValueError(f"Входной порт подсистемы '{port}' не используется.")
    for port in interface_outputs:
        if port not in expansion.output_sources:
            raise ValueError(f"Выходной порт подсистемы '{port}' не подключен.")

    return expansion


def flatten_diagram(diagram: Diagram) -> Diagram:
    """Recursively replace Subsystem wrappers with prefixed internal blocks."""

    expansion = _expand_level(diagram, "")
    if expansion.input_targets or expansion.output_sources:
        raise ValueError("Интерфейсные блоки допустимы только внутри Subsystem.")
    return Diagram(blocks=expansion.blocks, connections=expansion.connections)

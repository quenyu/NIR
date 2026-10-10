from __future__ import annotations

from dataclasses import dataclass, field

from app.models.diagram import Block, Connection, Diagram

Endpoint = tuple[str, str]

# Marker for a subsystem output that is wired straight to one of its inputs.
# Such an output has no internal source block: the parent level resolves it to
# whatever drives the corresponding input port.
INPUT_ALIAS = "@input"

PATH_SEPARATOR = "::"
LABEL_SEPARATOR = "/"


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


def subsystem_label_path(prefix: str) -> str:
    """'outer::inner::' -> 'outer/inner'."""

    return LABEL_SEPARATOR.join(part for part in prefix.split(PATH_SEPARATOR) if part)


def _nested_diagram(block: Block) -> Diagram:
    raw = block.parameters.get("diagram")
    if not isinstance(raw, dict):
        raise ValueError(f"Подсистема '{block.id}' не содержит вложенную схему.")
    return Diagram.model_validate(raw)


def _copy_block(block: Block, prefix: str) -> Block:
    copied = block.model_copy(deep=True)
    copied.id = _prefix_id(prefix, block.id)
    if block.type == "Scope" and prefix:
        # Scope labels name result signals; prefix them with the subsystem path
        # so that several instances of one subsystem stay distinguishable.
        label = str(block.parameters.get("label") or "").strip() or block.id
        copied.parameters["label"] = f"{subsystem_label_path(prefix)}{LABEL_SEPARATOR}{label}"
    return copied


def _expand_level(diagram: Diagram, prefix: str) -> DiagramExpansion:
    expansion = DiagramExpansion()
    blocks_by_id = {block.id: block for block in diagram.blocks}
    child_expansions: dict[str, DiagramExpansion] = {}
    incoming: dict[Endpoint, Endpoint] = {
        (connection.to_block, connection.to_port): (connection.from_block, connection.from_port)
        for connection in diagram.connections
    }

    for block in diagram.blocks:
        if block.type == "Subsystem":
            child = _expand_level(_nested_diagram(block), f"{prefix}{block.id}{PATH_SEPARATOR}")
            child_expansions[block.id] = child
            expansion.blocks.extend(child.blocks)
            expansion.connections.extend(child.connections)
        elif block.type not in {"SubsystemInput", "SubsystemOutput"}:
            expansion.blocks.append(_copy_block(block, prefix))

    def source_endpoint(block_id: str, port: str, visiting: frozenset[str] = frozenset()) -> Endpoint:
        """Resolve the flattened signal source behind an output port of this level.

        Returns (INPUT_ALIAS, port) when the signal comes from an interface
        input of this level, so that the parent can resolve it further.
        """

        block = blocks_by_id[block_id]
        if block.type == "SubsystemInput":
            return (INPUT_ALIAS, _port_name(block))
        if block.type != "Subsystem":
            return (_prefix_id(prefix, block_id), port)

        source = child_expansions[block_id].output_sources.get(port)
        if source is None:
            raise ValueError(f"Подсистема '{block_id}' не формирует выходной порт '{port}'.")
        if source[0] != INPUT_ALIAS:
            return source

        # The child passes one of its inputs straight through to this output.
        key = f"{block_id}.{source[1]}"
        if key in visiting:
            raise ValueError(f"Подсистема '{block_id}' замыкает собственный вход на выход по кругу.")
        upstream = incoming.get((block_id, source[1]))
        if upstream is None:
            raise ValueError(f"Вход '{source[1]}' подсистемы '{block_id}' не подключен.")
        return source_endpoint(upstream[0], upstream[1], visiting | {key})

    def target_endpoints(block_id: str, port: str) -> list[Endpoint] | None:
        block = blocks_by_id[block_id]
        if block.type == "SubsystemOutput":
            return None
        if block.type == "Subsystem":
            # An input that is only passed through has no internal targets; its
            # consumers are reached through the resolved output instead.
            return child_expansions[block_id].input_targets.get(port, [])
        return [(_prefix_id(prefix, block_id), port)]

    for connection in diagram.connections:
        target_block = blocks_by_id[connection.to_block]
        source = source_endpoint(connection.from_block, connection.from_port)

        if target_block.type == "SubsystemOutput":
            output_port = _port_name(target_block)
            if output_port in expansion.output_sources:
                raise ValueError(f"Выходной порт подсистемы '{output_port}' имеет несколько источников.")
            expansion.output_sources[output_port] = source
            continue

        targets = target_endpoints(connection.to_block, connection.to_port) or []
        if source[0] == INPUT_ALIAS:
            expansion.input_targets.setdefault(source[1], []).extend(targets)
            continue
        for target in targets:
            expansion.connections.append(
                Connection(
                    from_block=source[0],
                    from_port=source[1],
                    to_block=target[0],
                    to_port=target[1],
                )
            )

    interface_inputs = [_port_name(block) for block in diagram.blocks if block.type == "SubsystemInput"]
    interface_outputs = [_port_name(block) for block in diagram.blocks if block.type == "SubsystemOutput"]
    if len(set(interface_inputs)) != len(interface_inputs):
        raise ValueError("Имена входных портов подсистемы должны быть уникальными.")
    if len(set(interface_outputs)) != len(interface_outputs):
        raise ValueError("Имена выходных портов подсистемы должны быть уникальными.")
    passed_through = {source[1] for source in expansion.output_sources.values() if source[0] == INPUT_ALIAS}
    for port in interface_inputs:
        if not expansion.input_targets.get(port) and port not in passed_through:
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

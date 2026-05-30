from __future__ import annotations

from collections import defaultdict, deque

from app.core.block_specs import (
    KNOWN_BLOCK_TYPES,
    expected_input_ports,
    expected_output_ports,
    has_direct_feedthrough,
    validate_parameters,
)
from app.models.diagram import Block, Diagram


def _find_cycle(adjacency: dict[str, set[str]]) -> list[str] | None:
    visited: set[str] = set()
    visiting: set[str] = set()
    stack: list[str] = []

    def dfs(node: str) -> list[str] | None:
        visiting.add(node)
        stack.append(node)

        for neighbor in adjacency.get(node, set()):
            if neighbor in visiting:
                cycle_start = stack.index(neighbor)
                return stack[cycle_start:] + [neighbor]
            if neighbor not in visited:
                cycle = dfs(neighbor)
                if cycle is not None:
                    return cycle

        visiting.remove(node)
        visited.add(node)
        stack.pop()
        return None

    for node in adjacency:
        if node not in visited:
            cycle = dfs(node)
            if cycle is not None:
                return cycle
    return None


def _block_lookup(blocks: list[Block]) -> tuple[dict[str, Block], list[str]]:
    errors: list[str] = []
    by_id: dict[str, Block] = {}

    for block in blocks:
        if not block.id.strip():
            errors.append("Идентификатор блока не может быть пустым.")
            continue
        if block.id in by_id:
            errors.append(f"Дублирующийся идентификатор блока '{block.id}'.")
            continue
        by_id[block.id] = block

    return by_id, errors


def validate_diagram(diagram: Diagram) -> list[str]:
    errors: list[str] = []
    blocks_by_id, id_errors = _block_lookup(diagram.blocks)
    errors.extend(id_errors)

    expected_ports: dict[str, tuple[list[str], list[str]]] = {}

    for block in diagram.blocks:
        if block.type not in KNOWN_BLOCK_TYPES:
            errors.append(f"Блок '{block.id}' имеет неизвестный тип '{block.type}'.")
            continue

        param_errors = validate_parameters(block.type, block.parameters)
        errors.extend([f"Блок '{block.id}': {message}" for message in param_errors])

        expected_inputs = expected_input_ports(block.type, block.parameters)
        expected_outputs = expected_output_ports(block.type, block.parameters)
        expected_ports[block.id] = (expected_inputs, expected_outputs)

        if block.input_ports != expected_inputs:
            errors.append(
                f"Блок '{block.id}': входные порты должны быть {expected_inputs}, получено {block.input_ports}."
            )
        if block.output_ports != expected_outputs:
            errors.append(
                f"Блок '{block.id}': выходные порты должны быть {expected_outputs}, получено {block.output_ports}."
            )

    incoming_count: dict[tuple[str, str], int] = defaultdict(int)
    valid_refs: list[tuple[str, str]] = []

    for connection in diagram.connections:
        from_block = blocks_by_id.get(connection.from_block)
        to_block = blocks_by_id.get(connection.to_block)

        if from_block is None:
            errors.append(
                f"Связь ссылается на неизвестный исходный блок '{connection.from_block}'."
            )
            continue
        if to_block is None:
            errors.append(f"Связь ссылается на неизвестный целевой блок '{connection.to_block}'.")
            continue

        _, from_expected_outputs = expected_ports.get(from_block.id, ([], []))
        to_expected_inputs, _ = expected_ports.get(to_block.id, ([], []))

        if connection.from_port not in from_expected_outputs:
            errors.append(
                f"Связь от блока '{from_block.id}' использует неизвестный выходной порт "
                f"'{connection.from_port}'."
            )
            continue
        if connection.to_port not in to_expected_inputs:
            errors.append(
                f"Связь к блоку '{to_block.id}' использует неизвестный входной порт '{connection.to_port}'."
            )
            continue

        incoming_key = (connection.to_block, connection.to_port)
        incoming_count[incoming_key] += 1
        valid_refs.append((connection.from_block, connection.to_block))

    for (block_id, port), count in incoming_count.items():
        if count > 1:
            errors.append(
                f"Входной порт '{port}' блока '{block_id}' имеет несколько входящих связей."
            )

    for block_id, (inputs, _) in expected_ports.items():
        for port in inputs:
            if incoming_count[(block_id, port)] == 0:
                errors.append(f"Обязательный вход '{port}' блока '{block_id}' не подключен.")

    algebraic_nodes = {
        block.id
        for block in diagram.blocks
        if block.type in KNOWN_BLOCK_TYPES
        and has_direct_feedthrough(block.type, block.parameters)
        and expected_output_ports(block.type, block.parameters)
    }

    adjacency: dict[str, set[str]] = {node: set() for node in algebraic_nodes}
    for source_id, target_id in valid_refs:
        if source_id in algebraic_nodes and target_id in algebraic_nodes:
            adjacency[source_id].add(target_id)

    cycle = _find_cycle(adjacency)
    if cycle is not None:
        errors.append(
            "Обнаружена алгебраическая петля без динамического элемента: " + " -> ".join(cycle)
        )

    return errors


def static_topological_sort(
    block_ids: list[str], edges: list[tuple[str, str]]
) -> list[str]:
    adjacency: dict[str, set[str]] = {block_id: set() for block_id in block_ids}
    indegree: dict[str, int] = {block_id: 0 for block_id in block_ids}

    for source, target in edges:
        if source not in adjacency or target not in adjacency:
            continue
        if target in adjacency[source]:
            continue
        adjacency[source].add(target)
        indegree[target] += 1

    queue = deque(sorted([node for node, degree in indegree.items() if degree == 0]))
    ordered: list[str] = []
    while queue:
        node = queue.popleft()
        ordered.append(node)
        for neighbor in sorted(adjacency[node]):
            indegree[neighbor] -= 1
            if indegree[neighbor] == 0:
                queue.append(neighbor)

    if len(ordered) != len(block_ids):
        raise ValueError("Статический граф блоков содержит цикл.")

    return ordered

from __future__ import annotations

from collections import defaultdict

from pydantic import ValidationError

from app.core.block_specs import (
    KNOWN_BLOCK_TYPES,
    expected_input_ports,
    expected_output_ports,
    validate_parameters,
)
from app.models.diagram import Block, Diagram
from app.simulation.hierarchy import flatten_diagram


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


def _validate_level(diagram: Diagram, *, allow_interface_blocks: bool) -> list[str]:
    errors: list[str] = []
    blocks_by_id, id_errors = _block_lookup(diagram.blocks)
    errors.extend(id_errors)

    expected_ports: dict[str, tuple[list[str], list[str]]] = {}

    for block in diagram.blocks:
        if block.type not in KNOWN_BLOCK_TYPES:
            errors.append(f"Блок '{block.id}' имеет неизвестный тип '{block.type}'.")
            continue

        if block.type in {"SubsystemInput", "SubsystemOutput"} and not allow_interface_blocks:
            errors.append(
                f"Блок '{block.id}' типа '{block.type}' допустим только внутри Subsystem."
            )

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

        if block.type == "Subsystem" and isinstance(block.parameters.get("diagram"), dict):
            try:
                nested = Diagram.model_validate(block.parameters["diagram"])
            except ValidationError as exc:
                errors.append(f"Подсистема '{block.id}': некорректный формат: {exc}")
            else:
                nested_errors = _validate_level(nested, allow_interface_blocks=True)
                errors.extend(
                    [f"Подсистема '{block.id}': {message}" for message in nested_errors]
                )

    scope_labels: dict[str, str] = {}
    for block in diagram.blocks:
        if block.type != "Scope":
            continue
        requested_label = str(block.parameters.get("label") or "").strip()
        effective_label = requested_label or block.id
        previous_block = scope_labels.get(effective_label)
        if previous_block is not None:
            errors.append(
                f"Блоки Scope '{previous_block}' и '{block.id}' используют одинаковое "
                f"имя сигнала '{effective_label}'."
            )
        else:
            scope_labels[effective_label] = block.id

    incoming_count: dict[tuple[str, str], int] = defaultdict(int)

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

    for (block_id, port), count in incoming_count.items():
        if count > 1:
            errors.append(
                f"Входной порт '{port}' блока '{block_id}' имеет несколько входящих связей."
            )

    for block_id, (inputs, _) in expected_ports.items():
        for port in inputs:
            if incoming_count[(block_id, port)] == 0:
                errors.append(f"Обязательный вход '{port}' блока '{block_id}' не подключен.")

    return errors


def validate_structure(diagram: Diagram) -> tuple[Diagram | None, list[str]]:
    """Check every hierarchy level, flatten once and check the flat diagram.

    Returns the flattened diagram when the structure is valid. Algebraic loops
    are not rejected here: whether a loop is solvable is a numerical property
    decided when the model is assembled.
    """

    hierarchy_errors = _validate_level(diagram, allow_interface_blocks=False)
    if hierarchy_errors:
        return None, hierarchy_errors

    try:
        flattened = flatten_diagram(diagram)
    except (ValueError, ValidationError) as exc:
        return None, [f"Ошибка иерархии подсистем: {exc}"]

    flat_errors = _validate_level(flattened, allow_interface_blocks=False)
    return (None, flat_errors) if flat_errors else (flattened, [])

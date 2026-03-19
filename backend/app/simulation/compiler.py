from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.core.block_specs import (
    DYNAMIC_BLOCK_TYPES,
    get_numeric_parameter,
    get_signs,
)
from app.models.diagram import Block, Diagram
from app.simulation.blocks import (
    first_order_lag_derivative,
    gain_output,
    integrator_derivative,
    second_order_oscillator_derivative,
    step_input,
    sum_output,
)
from app.validation.validator import static_topological_sort, validate_diagram


class DiagramCompilationError(ValueError):
    def __init__(self, errors: list[str]):
        super().__init__("Не удалось скомпилировать схему.")
        self.errors = errors


@dataclass(frozen=True)
class ScopeBinding:
    scope_id: str
    label: str
    source_block: str
    source_port: str


@dataclass
class CompiledDiagram:
    diagram: Diagram
    blocks_by_id: dict[str, Block]
    incoming: dict[tuple[str, str], tuple[str, str]]
    static_order: list[str]
    dynamic_state_slices: dict[str, slice]
    initial_state: np.ndarray
    scopes: list[ScopeBinding]

    def _input_value(
        self,
        block_id: str,
        port: str,
        outputs: dict[tuple[str, str], float],
    ) -> float:
        source = self.incoming.get((block_id, port))
        if source is None:
            raise KeyError(f"Вход '{port}' блока '{block_id}' не подключен.")
        if source not in outputs:
            raise KeyError(
                f"Значение источника для блока '{source[0]}' порта '{source[1]}' недоступно."
            )
        return outputs[source]

    def evaluate_outputs(self, t: float, x: np.ndarray) -> dict[tuple[str, str], float]:
        outputs: dict[tuple[str, str], float] = {}

        for block in self.diagram.blocks:
            if block.type == "StepInput":
                amplitude = get_numeric_parameter(block.parameters, "amplitude", 1.0)
                t0 = get_numeric_parameter(block.parameters, "t0", 0.0)
                outputs[(block.id, "out")] = step_input(t, amplitude, t0)
            elif block.type == "Integrator":
                state_slice = self.dynamic_state_slices[block.id]
                outputs[(block.id, "out")] = float(x[state_slice.start])
            elif block.type == "FirstOrderLag":
                state_slice = self.dynamic_state_slices[block.id]
                outputs[(block.id, "out")] = float(x[state_slice.start])
            elif block.type == "SecondOrderOscillator":
                state_slice = self.dynamic_state_slices[block.id]
                outputs[(block.id, "out")] = float(x[state_slice.start])

        for block_id in self.static_order:
            block = self.blocks_by_id[block_id]
            if block.type == "Gain":
                k = get_numeric_parameter(block.parameters, "k", 1.0)
                x_in = self._input_value(block.id, "in", outputs)
                outputs[(block.id, "out")] = gain_output(k, x_in)
            elif block.type == "Sum":
                signs = get_signs(block.parameters)
                ports = [f"in{i + 1}" for i in range(len(signs))]
                values = [self._input_value(block.id, port, outputs) for port in ports]
                outputs[(block.id, "out")] = sum_output(values, signs)

        return outputs

    def rhs(self, t: float, x: np.ndarray) -> np.ndarray:
        if self.initial_state.size == 0:
            return np.zeros(0, dtype=float)

        outputs = self.evaluate_outputs(t, x)
        derivatives = np.zeros_like(x, dtype=float)

        for block in self.diagram.blocks:
            if block.type not in DYNAMIC_BLOCK_TYPES:
                continue

            state_slice = self.dynamic_state_slices[block.id]
            x_in = self._input_value(block.id, "in", outputs)

            if block.type == "Integrator":
                k = get_numeric_parameter(block.parameters, "k", 1.0)
                derivatives[state_slice.start] = integrator_derivative(k, x_in)

            elif block.type == "FirstOrderLag":
                k = get_numeric_parameter(block.parameters, "k", 1.0)
                t_const = get_numeric_parameter(block.parameters, "T", 1.0)
                y = float(x[state_slice.start])
                derivatives[state_slice.start] = first_order_lag_derivative(
                    k, t_const, x_in, y
                )

            elif block.type == "SecondOrderOscillator":
                k = get_numeric_parameter(block.parameters, "k", 1.0)
                wn = get_numeric_parameter(block.parameters, "wn", 1.0)
                zeta = get_numeric_parameter(block.parameters, "zeta", 0.2)
                y = float(x[state_slice.start])
                y_dot = float(x[state_slice.start + 1])
                dy, ddy = second_order_oscillator_derivative(k, wn, zeta, x_in, y, y_dot)
                derivatives[state_slice.start] = dy
                derivatives[state_slice.start + 1] = ddy

        return derivatives

    def evaluate_scopes(self, t: float, x: np.ndarray) -> dict[str, float]:
        outputs = self.evaluate_outputs(t, x)
        scope_values: dict[str, float] = {}
        for scope in self.scopes:
            value = outputs[(scope.source_block, scope.source_port)]
            scope_values[scope.label] = float(value)
        return scope_values


def _build_incoming_map(diagram: Diagram) -> dict[tuple[str, str], tuple[str, str]]:
    incoming: dict[tuple[str, str], tuple[str, str]] = {}
    for connection in diagram.connections:
        incoming[(connection.to_block, connection.to_port)] = (
            connection.from_block,
            connection.from_port,
        )
    return incoming


def _build_static_order(diagram: Diagram) -> list[str]:
    static_nodes = [block.id for block in diagram.blocks if block.type in {"Gain", "Sum"}]
    static_edges: list[tuple[str, str]] = []
    for connection in diagram.connections:
        static_edges.append((connection.from_block, connection.to_block))
    return static_topological_sort(static_nodes, static_edges)


def _build_dynamic_state(diagram: Diagram) -> tuple[dict[str, slice], np.ndarray]:
    dynamic_state_slices: dict[str, slice] = {}
    initial_values: list[float] = []

    for block in diagram.blocks:
        if block.type == "Integrator":
            start = len(initial_values)
            y0 = get_numeric_parameter(block.parameters, "y0", 0.0)
            initial_values.append(y0)
            dynamic_state_slices[block.id] = slice(start, start + 1)

        elif block.type == "FirstOrderLag":
            start = len(initial_values)
            y0 = get_numeric_parameter(block.parameters, "y0", 0.0)
            initial_values.append(y0)
            dynamic_state_slices[block.id] = slice(start, start + 1)

        elif block.type == "SecondOrderOscillator":
            start = len(initial_values)
            y0 = get_numeric_parameter(block.parameters, "y0", 0.0)
            v0 = get_numeric_parameter(block.parameters, "v0", 0.0)
            initial_values.extend([y0, v0])
            dynamic_state_slices[block.id] = slice(start, start + 2)

    return dynamic_state_slices, np.array(initial_values, dtype=float)


def _build_scopes(
    diagram: Diagram,
    incoming: dict[tuple[str, str], tuple[str, str]],
) -> list[ScopeBinding]:
    scopes: list[ScopeBinding] = []
    for block in diagram.blocks:
        if block.type != "Scope":
            continue
        source = incoming.get((block.id, "in"))
        if source is None:
            raise DiagramCompilationError([f"Блок Scope '{block.id}' не имеет подключенного входа."])
        label = str(block.parameters.get("label") or block.id)
        scopes.append(
            ScopeBinding(
                scope_id=block.id,
                label=label,
                source_block=source[0],
                source_port=source[1],
            )
        )
    return scopes


def compile_diagram(diagram: Diagram) -> CompiledDiagram:
    errors = validate_diagram(diagram)
    if errors:
        raise DiagramCompilationError(errors)

    blocks_by_id = {block.id: block for block in diagram.blocks}
    incoming = _build_incoming_map(diagram)
    static_order = _build_static_order(diagram)
    dynamic_state_slices, initial_state = _build_dynamic_state(diagram)
    scopes = _build_scopes(diagram, incoming)

    return CompiledDiagram(
        diagram=diagram,
        blocks_by_id=blocks_by_id,
        incoming=incoming,
        static_order=static_order,
        dynamic_state_slices=dynamic_state_slices,
        initial_state=initial_state,
        scopes=scopes,
    )

"""Assembly of a flattened block diagram into one LTI state-space model.

Every block i is a linear system

    x_i' = A_i x_i + B_i u_i,    y_i = C_i x_i + D_i u_i.

Stacking all blocks gives a block-diagonal model (A_d, B_d, C_d, D_d) over
the vector u_b of all block input ports and the vector y_b of all block
outputs. Connections are linear too: every input port reads exactly one
signal, which is either a block output or an external source r (StepInput):

    u_b = M y_b + N r,          z = S_y y_b + S_r r      (Scope readings).

Substituting u_b gives the algebraic equations of the diagram

    (I - D_d M) y_b = C_d x + D_d N r.

They are solvable exactly when I - D_d M is nonsingular (the diagram is
well-posed). With Y = [Y_x  Y_r] the solution y_b = Y_x x + Y_r r, the global
model is

    A = A_d + B_d M Y_x,   B = B_d (M Y_r + N),
    C = S_y Y_x,           D = S_y Y_r + S_r.

The system is solved block-triangularly: outputs are grouped into strongly
connected components of the feedthrough graph G = D_d M and processed in
topological order. Acyclic parts reduce to substitution; only a genuine
algebraic loop needs a linear solve, done with an LU factorisation after its
sensitivity kappa = (1 + ||G||) / sigma_min(I - G) is checked. This keeps long chains of large gains from being
mistaken for ill-conditioned loops, and names the blocks of a bad loop.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
from scipy.linalg import lu_factor, lu_solve
from scipy.signal import tf2ss
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import connected_components

from app.core.block_specs import (
    butterworth_coefficients,
    get_numeric_parameter,
    get_pid_coefficients,
    get_signs,
    get_transfer_function_coefficients,
)
from app.models.diagram import Block, Diagram

SOURCE_TYPES = {"StepInput"}
SINK_TYPES = {"Scope"}

# A loop whose sensitivity exceeds 1/sqrt(eps) loses more than half of the
# double-precision digits in the solve; the result is not trustworthy.
MAX_LOOP_CONDITION = 1.0 / np.sqrt(np.finfo(float).eps)


class ModelAssemblyError(ValueError):
    def __init__(self, errors: list[str]):
        super().__init__("Не удалось собрать модель схемы.")
        self.errors = errors


@dataclass(frozen=True)
class BlockRealization:
    a: np.ndarray
    b: np.ndarray
    c: np.ndarray
    d: np.ndarray
    x0: np.ndarray

    @property
    def order(self) -> int:
        return int(self.a.shape[0])


@dataclass(frozen=True)
class StateEntry:
    block_id: str
    block_type: str
    local_index: int
    label: str


@dataclass(frozen=True)
class StepSource:
    block_id: str
    amplitude: float
    t0: float


@dataclass(frozen=True)
class ScopeOutput:
    block_id: str
    label: str
    reference: float | None


@dataclass(frozen=True)
class AlgebraicLoop:
    blocks: list[str]
    condition_number: float


@dataclass
class LinearModel:
    """x' = A x + B r(t),  z = C x + D r(t), with r the StepInput signals."""

    a: np.ndarray
    b: np.ndarray
    c: np.ndarray
    d: np.ndarray
    x0: np.ndarray
    states: list[StateEntry]
    sources: list[StepSource]
    scopes: list[ScopeOutput]
    algebraic_loops: list[AlgebraicLoop] = field(default_factory=list)

    @property
    def state_dimension(self) -> int:
        return int(self.a.shape[0])

    def source_values(self, t: float) -> np.ndarray:
        return np.array(
            [source.amplitude if t >= source.t0 else 0.0 for source in self.sources],
            dtype=float,
        )

    def rhs(self, t: float, x: np.ndarray) -> np.ndarray:
        return self.a @ x + self.b @ self.source_values(t)

    def outputs(self, t: float, x: np.ndarray) -> np.ndarray:
        return self.c @ x + self.d @ self.source_values(t)

    def step_breakpoints(self, start: float, end: float) -> list[float]:
        return sorted({s.t0 for s in self.sources if start < s.t0 < end})


def _trim_leading_zeros(coefficients: list[float]) -> list[float]:
    for index, coefficient in enumerate(coefficients):
        if coefficient != 0.0:
            return coefficients[index:]
    return [0.0]


def _transfer_function_realization(numerator: list[float], denominator: list[float]) -> BlockRealization:
    order = len(denominator) - 1
    if order == 0:
        gain = _trim_leading_zeros(numerator)[-1] / denominator[-1]
        return _static(np.array([[gain]], dtype=float))
    # Controllable canonical form, the same realization the block evaluator uses.
    a, b, c, d = tf2ss(_trim_leading_zeros(numerator), denominator)
    return BlockRealization(
        a=np.asarray(a, dtype=float),
        b=np.asarray(b, dtype=float).reshape(order, 1),
        c=np.asarray(c, dtype=float).reshape(1, order),
        d=np.asarray(d, dtype=float).reshape(1, 1),
        x0=np.zeros(order, dtype=float),
    )


def _static(d: np.ndarray) -> BlockRealization:
    inputs = d.shape[1]
    return BlockRealization(
        a=np.zeros((0, 0)),
        b=np.zeros((0, inputs)),
        c=np.zeros((1, 0)),
        d=d,
        x0=np.zeros(0),
    )


def _minimum_norm_state(c: np.ndarray, output_value: float) -> np.ndarray:
    """State of least Euclidean norm with C x = y0 (Butterworth y0 convention)."""

    row = c.reshape(-1)
    norm_sq = float(row @ row)
    if norm_sq <= 1e-18:
        if abs(output_value) <= 1e-15:
            return np.zeros(row.size)
        raise ValueError("Для выбранной реализации нельзя задать ненулевое начальное y0.")
    return row * (output_value / norm_sq)


def block_realization(block: Block) -> BlockRealization:
    p = block.parameters
    kind = block.type
    if kind == "Gain":
        return _static(np.array([[get_numeric_parameter(p, "k", 1.0)]]))
    if kind == "Sum":
        signs = get_signs(p)
        return _static(np.array([[1.0 if sign == "+" else -1.0 for sign in signs]]))
    if kind == "Integrator":
        k = get_numeric_parameter(p, "k", 1.0)
        return BlockRealization(
            a=np.zeros((1, 1)), b=np.array([[k]]), c=np.ones((1, 1)), d=np.zeros((1, 1)),
            x0=np.array([get_numeric_parameter(p, "y0", 0.0)]),
        )
    if kind == "FirstOrderLag":
        k = get_numeric_parameter(p, "k", 1.0)
        t_const = get_numeric_parameter(p, "T", 1.0)
        return BlockRealization(
            a=np.array([[-1.0 / t_const]]), b=np.array([[k / t_const]]),
            c=np.ones((1, 1)), d=np.zeros((1, 1)),
            x0=np.array([get_numeric_parameter(p, "y0", 0.0)]),
        )
    if kind == "SecondOrderOscillator":
        k = get_numeric_parameter(p, "k", 1.0)
        wn = get_numeric_parameter(p, "wn", 1.0)
        zeta = get_numeric_parameter(p, "zeta", 0.2)
        return BlockRealization(
            a=np.array([[0.0, 1.0], [-wn * wn, -2.0 * zeta * wn]]),
            b=np.array([[0.0], [k * wn * wn]]),
            c=np.array([[1.0, 0.0]]),
            d=np.zeros((1, 1)),
            x0=np.array([get_numeric_parameter(p, "y0", 0.0), get_numeric_parameter(p, "v0", 0.0)]),
        )
    if kind == "TransferFunction":
        return _transfer_function_realization(*get_transfer_function_coefficients(p))
    if kind == "PIDController":
        return _transfer_function_realization(*get_pid_coefficients(p))
    if kind == "ButterworthLPF":
        order = int(get_numeric_parameter(p, "order", 2))
        realization = _transfer_function_realization(
            *butterworth_coefficients(order, get_numeric_parameter(p, "cutoff_freq", 10.0))
        )
        x0 = _minimum_norm_state(realization.c, get_numeric_parameter(p, "y0", 0.0))
        return BlockRealization(realization.a, realization.b, realization.c, realization.d, x0)
    raise ValueError(f"Блок '{block.id}' типа '{kind}' не может входить в плоскую модель.")


def _block_diagonal(blocks: list[np.ndarray], rows: int, cols: int) -> np.ndarray:
    result = np.zeros((rows, cols))
    r = c = 0
    for block in blocks:
        result[r : r + block.shape[0], c : c + block.shape[1]] = block
        r += block.shape[0]
        c += block.shape[1]
    return result


def _topological_components(g: np.ndarray) -> list[list[int]]:
    """Strongly connected components of 'j feeds i' (g[i, j] != 0), sources first."""

    count = g.shape[0]
    if count == 0:
        return []
    adjacency = csr_matrix((g != 0.0).T.astype(np.int8))  # edge j -> i
    n_components, labels = connected_components(adjacency, directed=True, connection="strong")
    members: list[list[int]] = [[] for _ in range(n_components)]
    for index, label in enumerate(labels):
        members[label].append(index)

    successors: list[set[int]] = [set() for _ in range(n_components)]
    indegree = [0] * n_components
    rows, cols = np.nonzero(g)
    for i, j in zip(rows, cols):
        source, target = labels[j], labels[i]
        if source != target and target not in successors[source]:
            successors[source].add(target)
            indegree[target] += 1
    ready = sorted(c for c in range(n_components) if indegree[c] == 0)
    ordered: list[list[int]] = []
    while ready:
        component = ready.pop(0)
        ordered.append(members[component])
        for successor in sorted(successors[component]):
            indegree[successor] -= 1
            if indegree[successor] == 0:
                ready.append(successor)
    return ordered


def _solve_algebraic_equations(
    g: np.ndarray,
    rhs: np.ndarray,
    owners: list[str],
) -> tuple[np.ndarray, list[AlgebraicLoop]]:
    """Solve (I - g) Y = rhs component by component."""

    solution = np.zeros_like(rhs)
    loops: list[AlgebraicLoop] = []
    eps = np.finfo(float).eps
    for component in _topological_components(g):
        index = np.asarray(component)
        local_rhs = rhs[index] + g[index] @ solution  # unsolved rows of solution are still zero
        if index.size == 1 and g[index[0], index[0]] == 0.0:
            solution[index] = local_rhs
            continue

        loop_blocks = sorted({owners[i] for i in component})
        loop_gain = g[np.ix_(index, index)]
        matrix = np.eye(index.size) - loop_gain
        smallest = float(np.linalg.svd(matrix, compute_uv=False)[-1])
        # Relative sensitivity of the loop solution to perturbations of the
        # loop coefficients: kappa = (1 + ||G||) / sigma_min(I - G). For a
        # scalar loop y = k y + ... this is (1 + |k|) / |1 - k|.
        scale = 1.0 + float(np.linalg.norm(loop_gain, 2))
        if smallest <= eps * scale * index.size:
            raise ModelAssemblyError(
                [
                    "Алгебраическая петля не имеет решения (матрица I − D·M вырождена): "
                    + " → ".join(loop_blocks)
                    + ". Измените коэффициенты петли или добавьте динамическое звено."
                ]
            )
        condition = scale / smallest
        if condition > MAX_LOOP_CONDITION:
            raise ModelAssemblyError(
                [
                    f"Алгебраическая петля плохо обусловлена (κ = {condition:.3g}): "
                    + " → ".join(loop_blocks)
                    + ". Результат расчёта был бы недостоверным."
                ]
            )
        solution[index] = lu_solve(lu_factor(matrix), local_rhs)
        loops.append(AlgebraicLoop(blocks=loop_blocks, condition_number=condition))
    return solution, loops


def assemble_linear_model(flat: Diagram) -> LinearModel:
    """Assemble a validated, flattened diagram into (A, B, C, D)."""

    sources: list[StepSource] = []
    scopes: list[ScopeOutput] = []
    source_index: dict[str, int] = {}
    scope_index: dict[str, int] = {}

    dynamic: list[tuple[Block, BlockRealization]] = []
    output_index: dict[str, int] = {}      # block id -> row of y_b
    input_offset: dict[str, int] = {}      # block id -> first row of u_b
    states: list[StateEntry] = []
    total_inputs = 0

    for block in flat.blocks:
        if block.type in SOURCE_TYPES:
            source_index[block.id] = len(sources)
            sources.append(
                StepSource(
                    block.id,
                    get_numeric_parameter(block.parameters, "amplitude", 1.0),
                    get_numeric_parameter(block.parameters, "t0", 0.0),
                )
            )
            continue
        if block.type in SINK_TYPES:
            label = str(block.parameters.get("label") or "").strip() or block.id
            reference = (
                get_numeric_parameter(block.parameters, "reference", 0.0)
                if "reference" in block.parameters
                else None
            )
            scope_index[block.id] = len(scopes)
            scopes.append(ScopeOutput(block.id, label, reference))
            continue

        realization = block_realization(block)
        if realization.b.shape[1] != len(block.input_ports):
            raise ModelAssemblyError(
                [f"Блок '{block.id}': число входов не совпадает с моделью звена."]
            )
        output_index[block.id] = len(dynamic)
        input_offset[block.id] = total_inputs
        total_inputs += len(block.input_ports)
        for local in range(realization.order):
            label = block.id if realization.order == 1 else f"{block.id}.x{local + 1}"
            states.append(StateEntry(block.id, block.type, local, label))
        dynamic.append((block, realization))

    realizations = [realization for _, realization in dynamic]
    n = sum(r.order for r in realizations)
    n_out = len(dynamic)
    n_src = len(sources)
    p = len(scopes)

    a_d = _block_diagonal([r.a for r in realizations], n, n)
    b_d = _block_diagonal([r.b for r in realizations], n, total_inputs)
    c_d = _block_diagonal([r.c for r in realizations], n_out, n)
    d_d = _block_diagonal([r.d for r in realizations], n_out, total_inputs)
    x0 = np.concatenate([r.x0 for r in realizations]) if realizations else np.zeros(0)

    m = np.zeros((total_inputs, n_out))
    nr = np.zeros((total_inputs, n_src))
    s_y = np.zeros((p, n_out))
    s_r = np.zeros((p, n_src))
    blocks_by_id = {block.id: block for block in flat.blocks}

    for connection in flat.connections:
        target = blocks_by_id[connection.to_block]
        if target.type in SINK_TYPES:
            row_matrix_y, row_matrix_r, row = s_y, s_r, scope_index[target.id]
        else:
            row = input_offset[target.id] + target.input_ports.index(connection.to_port)
            row_matrix_y, row_matrix_r = m, nr
        if connection.from_block in source_index:
            row_matrix_r[row, source_index[connection.from_block]] = 1.0
        else:
            row_matrix_y[row, output_index[connection.from_block]] = 1.0

    g = d_d @ m
    owners = [block.id for block, _ in dynamic]
    y_solution, loops = _solve_algebraic_equations(g, np.hstack([c_d, d_d @ nr]), owners)
    y_x, y_r = y_solution[:, :n], y_solution[:, n:]

    return LinearModel(
        a=a_d + b_d @ m @ y_x,
        b=b_d @ (m @ y_r + nr),
        c=s_y @ y_x,
        d=s_y @ y_r + s_r,
        x0=x0,
        states=states,
        sources=sources,
        scopes=scopes,
        algebraic_loops=loops,
    )


def state_mapping(model: LinearModel) -> list[dict[str, Any]]:
    mapping = []
    for index, entry in enumerate(model.states):
        parts = entry.block_id.split("::")
        mapping.append(
            {
                "global_index": index,
                "label": entry.label,
                "block_id": entry.block_id,
                "local_block_id": parts[-1],
                "block_type": entry.block_type,
                "subsystem_path": parts[:-1],
                "local_index": entry.local_index,
            }
        )
    return mapping

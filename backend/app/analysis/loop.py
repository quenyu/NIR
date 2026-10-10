"""Stability margins of a closed loop broken at one connection of the diagram.

A block diagram does not say where "the loop" is, so the user picks a
connection on a cycle. The connection is removed, a probe step input u drives
its target port and a meter scope reads its source port y. The assembled model
of this broken diagram gives the transfer T(s) = y/u, and the loop transfer is
L(s) = -T(s): closing the cut again (u = y) gives the characteristic equation
1 + L(s) = 0.

From L(jw) the module computes the gain margin (at the phase crossover, where
L crosses the negative real axis), the phase margin (at the gain crossover,
|L| = 1) and the Nyquist criterion Z = N + P, where P counts the right-half-
plane poles of the broken diagram and N the clockwise encirclements of -1. Two
independent checks are returned with it: the poles of the closed loop and the
Hurwitz determinants of its characteristic polynomial.
"""

from __future__ import annotations

import math

import numpy as np
from scipy.optimize import brentq

from app.analysis.frequency import _frequency_range
from app.core.block_specs import expected_input_ports, expected_output_ports
from app.models.api import LoopCrossing, LoopCut, LoopRequest, LoopResponse
from app.models.diagram import Block, Connection, Diagram
from app.simulation.model import DiagramCompilationError, compile_model

PROBE_ID = "__loop_probe"
METER_ID = "__loop_meter"
PLOT_POINTS = 600
SEARCH_POINTS = 4000


def loop_candidates(diagram: Diagram) -> list[LoopCut]:
    """Top-level connections that lie on a cycle of the block graph."""

    ids = [block.id for block in diagram.blocks]
    successors: dict[str, set[str]] = {block_id: set() for block_id in ids}
    for c in diagram.connections:
        if c.from_block in successors and c.to_block in successors:
            successors[c.from_block].add(c.to_block)

    # Tarjan's strongly connected components (iterative).
    index: dict[str, int] = {}
    low: dict[str, int] = {}
    on_stack: set[str] = set()
    stack: list[str] = []
    component: dict[str, int] = {}
    counter = 0
    for root in ids:
        if root in index:
            continue
        work = [(root, iter(sorted(successors[root])))]
        index[root] = low[root] = counter
        counter += 1
        stack.append(root)
        on_stack.add(root)
        while work:
            node, children = work[-1]
            child = next(children, None)
            if child is not None:
                if child not in index:
                    index[child] = low[child] = counter
                    counter += 1
                    stack.append(child)
                    on_stack.add(child)
                    work.append((child, iter(sorted(successors[child]))))
                elif child in on_stack:
                    low[node] = min(low[node], index[child])
                continue
            work.pop()
            if work:
                low[work[-1][0]] = min(low[work[-1][0]], low[node])
            if low[node] == index[node]:
                while True:
                    member = stack.pop()
                    on_stack.discard(member)
                    component[member] = index[node]
                    if member == node:
                        break

    return [
        LoopCut(from_block=c.from_block, from_port=c.from_port, to_block=c.to_block, to_port=c.to_port)
        for c in diagram.connections
        if c.from_block in component
        and c.to_block in component
        and component[c.from_block] == component[c.to_block]
    ]


def _block(block_id: str, block_type: str, **parameters: object) -> Block:
    return Block(
        id=block_id,
        type=block_type,
        parameters=dict(parameters),
        input_ports=expected_input_ports(block_type, parameters),
        output_ports=expected_output_ports(block_type, parameters),
    )


def broken_diagram(diagram: Diagram, cut: LoopCut) -> Diagram:
    """The diagram with `cut` removed, a probe input on its target and a meter on its source."""

    connections = [
        c for c in diagram.connections
        if (c.from_block, c.from_port, c.to_block, c.to_port)
        != (cut.from_block, cut.from_port, cut.to_block, cut.to_port)
    ]
    if len(connections) == len(diagram.connections):
        raise DiagramCompilationError(["Выбранная связь для размыкания контура не найдена на верхнем уровне схемы."])
    blocks = [block.model_copy(deep=True) for block in diagram.blocks]
    blocks.append(_block(PROBE_ID, "StepInput", amplitude=1.0, t0=0.0))
    blocks.append(_block(METER_ID, "Scope", label=METER_ID))
    connections.append(Connection(from_block=PROBE_ID, from_port="out", to_block=cut.to_block, to_port=cut.to_port))
    connections.append(Connection(from_block=cut.from_block, from_port=cut.from_port, to_block=METER_ID, to_port="in"))
    return Diagram(blocks=blocks, connections=connections)


class LoopRealization:
    """SISO realization (A, b, c, d) of T(s) = y/u across the cut."""

    def __init__(self, diagram: Diagram, cut: LoopCut):
        model = compile_model(broken_diagram(diagram, cut)).model
        source = next(i for i, s in enumerate(model.sources) if s.block_id.endswith(PROBE_ID))
        scope = next(i for i, s in enumerate(model.scopes) if s.block_id.endswith(METER_ID))
        self.a = model.a
        self.b = model.b[:, source]
        self.c = model.c[scope, :]
        self.d = float(model.d[scope, source])
        self.n = model.state_dimension

    def loop(self, s: complex | np.ndarray) -> np.ndarray:
        """L(s) = -T(s) for one or many complex frequencies."""

        points = np.atleast_1d(np.asarray(s, dtype=complex))
        if self.n == 0:
            return np.full(points.shape, -self.d, dtype=complex)
        identity = np.eye(self.n)
        values = np.empty(points.shape, dtype=complex)
        for k, point in enumerate(points):
            values[k] = -(self.c @ np.linalg.solve(point * identity - self.a, self.b) + self.d)
        return values

    def open_poles(self) -> np.ndarray:
        return np.linalg.eigvals(self.a) if self.n else np.zeros(0, dtype=complex)

    def closed_matrix(self, gain: float = 1.0) -> np.ndarray:
        """State matrix of the loop closed through an extra gain k at the cut: u = k·y."""

        denominator = 1.0 - gain * self.d
        if abs(denominator) < 1e-12:
            raise DiagramCompilationError(["При замыкании контура получается вырожденная алгебраическая петля."])
        return self.a + gain * np.outer(self.b, self.c) / denominator


def hurwitz_determinants(polynomial: np.ndarray) -> list[float]:
    """Leading principal minors of the Hurwitz matrix of a0 s^n + a1 s^(n-1) + ... + an."""

    coefficients = np.asarray(polynomial, dtype=float)
    if coefficients[0] < 0:
        coefficients = -coefficients
    n = coefficients.size - 1

    def a(k: int) -> float:
        return float(coefficients[k]) if 0 <= k <= n else 0.0

    matrix = np.array([[a(2 * j - i + 1) for j in range(n)] for i in range(n)])
    return [float(np.linalg.det(matrix[:k, :k])) for k in range(1, n + 1)]


def _axis_poles(poles: np.ndarray, scale: float) -> list[float]:
    return [float(abs(p.imag)) for p in poles if abs(p.real) <= 1e-9 * scale]


def _guarded(omega: np.ndarray, axis: list[float]) -> np.ndarray:
    keep = np.ones(omega.shape, dtype=bool)
    for w0 in axis:
        keep &= np.abs(omega - w0) > 1e-6 * max(1.0, w0)
    return omega[keep]


def _encirclements(realization: LoopRealization, poles: np.ndarray, scale: float) -> int:
    """Clockwise encirclements of -1 by L along Re s = eps (axis poles are passed on the right)."""

    positive_real = [p.real for p in poles if p.real > 1e-9 * scale]
    eps = 1e-7 * scale
    if positive_real:
        eps = min(eps, 0.01 * min(positive_real))
    low, high = _frequency_range(poles)
    w = np.geomspace(low / 1e3, high * 1e3, SEARCH_POINTS)
    extra = []
    for w0 in _axis_poles(poles, scale):
        around = eps * np.geomspace(1e-2, 1e4, 120)
        extra += [w0 + around, w0 - around, -w0 + around, -w0 - around]
    omega = np.unique(np.concatenate([-w, [0.0], w, *extra]))
    values = 1.0 + realization.loop(eps + 1j * omega)
    angle = np.unwrap(np.angle(values))
    for _ in range(25):
        jumps = np.flatnonzero(np.abs(np.diff(angle)) > math.pi / 4)
        if jumps.size == 0:
            break
        middle = 0.5 * (omega[jumps] + omega[jumps + 1])
        omega = np.sort(np.concatenate([omega, middle]))
        values = 1.0 + realization.loop(eps + 1j * omega)
        angle = np.unwrap(np.angle(values))
    return -int(round((angle[-1] - angle[0]) / (2 * math.pi)))


def _crossings(func, omega: np.ndarray) -> list[float]:
    values = np.array([func(w) for w in omega])
    roots = []
    for k in np.flatnonzero(np.sign(values[:-1]) * np.sign(values[1:]) < 0):
        roots.append(float(brentq(func, omega[k], omega[k + 1], xtol=1e-14, rtol=1e-12)))
    return roots


def analyze_loop(request: LoopRequest) -> LoopResponse:
    diagram = request.diagram
    candidates = loop_candidates(diagram)
    if request.cut is None:
        return LoopResponse(candidates=candidates)
    cut = request.cut
    realization = LoopRealization(diagram, cut)
    poles = realization.open_poles()
    scale = max([1.0, *[abs(p) for p in poles]])
    axis = _axis_poles(poles, scale)
    notes: list[str] = []
    if not any(c == cut for c in candidates):
        notes.append("Выбранная связь не лежит на замкнутом контуре: L(s) описывает разомкнутую цепь.")

    low, high = _frequency_range(poles)
    plot_omega = _guarded(np.geomspace(low, high, PLOT_POINTS), axis)
    response = realization.loop(1j * plot_omega)
    magnitude = np.abs(response)
    finite = magnitude > 0

    search = _guarded(np.geomspace(low / 1e2, high * 1e2, SEARCH_POINTS), axis)

    def log_magnitude(w: float) -> float:
        return float(np.log(abs(realization.loop(1j * w)[0])))

    def imaginary(w: float) -> float:
        return float(realization.loop(1j * w)[0].imag)

    gain_crossings = []
    for w in _crossings(log_magnitude, search):
        phase = math.degrees(float(np.angle(realization.loop(1j * w)[0])))
        margin = (180.0 + phase + 180.0) % 360.0 - 180.0
        gain_crossings.append(LoopCrossing(frequency=w, value=margin))
    phase_crossings = []
    for w in _crossings(imaginary, search):
        value = realization.loop(1j * w)[0]
        if value.real < 0:
            phase_crossings.append(LoopCrossing(frequency=w, value=1.0 / abs(value)))
    if realization.n == 0 or 0.0 not in axis:
        at_zero = realization.loop(0.0)[0]
        if abs(at_zero.imag) <= 1e-12 * max(1.0, abs(at_zero)) and at_zero.real < 0:
            phase_crossings.insert(0, LoopCrossing(frequency=0.0, value=1.0 / abs(at_zero)))

    gain_margin = phase_crossover = phase_margin = gain_crossover = None
    if phase_crossings:
        primary = min(phase_crossings, key=lambda item: abs(math.log(item.value)))
        gain_margin, phase_crossover = primary.value, primary.frequency
    else:
        notes.append("Годограф L(jω) не пересекает отрицательную вещественную полуось: запас по амплитуде "
                     "не ограничен.")
    if gain_crossings:
        primary = min(gain_crossings, key=lambda item: item.value)
        phase_margin, gain_crossover = primary.value, primary.frequency
    else:
        notes.append("|L(jω)| не равен 1 ни на одной частоте: частоты среза нет, запас по фазе не определён.")

    unstable_open = int(sum(1 for p in poles if p.real > 1e-9 * scale))
    encirclements = _encirclements(realization, poles, scale)
    closed = realization.closed_matrix()
    closed_poles = np.linalg.eigvals(closed) if realization.n else np.zeros(0, dtype=complex)
    closed_scale = max([1.0, *[abs(p) for p in closed_poles]])
    unstable_closed = int(sum(1 for p in closed_poles if p.real > 1e-9 * closed_scale))
    on_axis = any(abs(p.real) <= 1e-9 * closed_scale for p in closed_poles)
    z = encirclements + unstable_open
    if on_axis:
        notes.append("Замкнутая система имеет полюс на мнимой оси: она на границе устойчивости.")

    original = compile_model(diagram).model
    original_poles = np.sort_complex(np.linalg.eigvals(original.a)) if original.state_dimension else np.zeros(0)
    if original_poles.size != closed_poles.size or not np.allclose(
        original_poles, np.sort_complex(closed_poles), atol=1e-7 * closed_scale
    ):
        notes.append("Полюса замыкания по разрезу не совпали с полюсами исходной схемы.")

    hurwitz = hurwitz_determinants(np.poly(closed).real) if realization.n else []
    return LoopResponse(
        candidates=candidates,
        cut=cut,
        frequency=plot_omega[finite].tolist(),
        magnitude_db=(20.0 * np.log10(magnitude[finite])).tolist(),
        phase_deg=np.degrees(np.unwrap(np.angle(response[finite]))).tolist(),
        nyquist_real=response.real.tolist(),
        nyquist_imag=response.imag.tolist(),
        gain_margin=gain_margin,
        gain_margin_db=None if gain_margin is None else 20.0 * math.log10(gain_margin),
        phase_crossover=phase_crossover,
        phase_margin=phase_margin,
        gain_crossover=gain_crossover,
        gain_crossings=gain_crossings,
        phase_crossings=phase_crossings,
        open_loop_unstable_poles=unstable_open,
        encirclements=encirclements,
        closed_loop_unstable_poles=unstable_closed,
        nyquist_stable=z == 0 and not on_axis,
        poles_agree=z == unstable_closed,
        hurwitz=hurwitz,
        hurwitz_stable=all(value > 0 for value in hurwitz) if hurwitz else True,
        notes=notes,
    )

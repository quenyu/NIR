"""Reference block diagrams with analytically known transfer functions.

Each case is a diagram (possibly hierarchical) together with the transfer
matrix G(s) that block-diagram algebra gives for it. The cases are used to
check any model builder: the compiled model must satisfy
C (sI - A)^-1 B + D = G(s) at a few complex points, independently of how the
states are ordered.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from app.core.block_specs import expected_input_ports, expected_output_ports

TransferMatrix = Callable[[complex], np.ndarray]


class DiagramBuilder:
    def __init__(self) -> None:
        self.blocks: list[dict[str, Any]] = []
        self.connections: list[dict[str, str]] = []

    def add(self, block_id: str, block_type: str, **parameters: Any) -> str:
        self.blocks.append(
            {
                "id": block_id,
                "type": block_type,
                "parameters": parameters,
                "input_ports": expected_input_ports(block_type, parameters),
                "output_ports": expected_output_ports(block_type, parameters),
            }
        )
        return block_id

    def subsystem(self, block_id: str, inner: DiagramBuilder) -> str:
        return self.add(block_id, "Subsystem", diagram=inner.build())

    def link(self, source: str, target: str, *, out: str = "out", into: str = "in") -> None:
        self.connections.append(
            {"from_block": source, "from_port": out, "to_block": target, "to_port": into}
        )

    def build(self) -> dict[str, Any]:
        return {"blocks": list(self.blocks), "connections": list(self.connections)}


@dataclass(frozen=True)
class StructuralCase:
    name: str
    diagram: dict[str, Any]
    transfer: TransferMatrix
    output_labels: list[str] = field(default_factory=lambda: ["y"])
    # The block-by-block compiler that predates the interconnection assembly
    # rejects some well-posed diagrams; those cases are skipped for it.
    supported_by_legacy_compiler: bool = True


def _tf(numerator: list[float], denominator: list[float]) -> Callable[[complex], complex]:
    return lambda s: np.polyval(numerator, s) / np.polyval(denominator, s)


def _siso(fn: Callable[[complex], complex]) -> TransferMatrix:
    return lambda s: np.array([[fn(s)]], dtype=complex)


def _source_and_scope(builder: DiagramBuilder, label: str = "y") -> tuple[str, str]:
    source = builder.add("u", "StepInput", amplitude=1.0, t0=0.0)
    scope = builder.add(f"scope_{label}", "Scope", label=label)
    return source, scope


def series_case() -> StructuralCase:
    b = DiagramBuilder()
    u, y = _source_and_scope(b)
    b.add("g1", "TransferFunction", numerator=[1.0], denominator=[1.0, 1.0])
    b.add("g2", "TransferFunction", numerator=[2.0], denominator=[1.0, 3.0])
    b.link(u, "g1")
    b.link("g1", "g2")
    b.link("g2", y)
    g1, g2 = _tf([1.0], [1.0, 1.0]), _tf([2.0], [1.0, 3.0])
    return StructuralCase("series", b.build(), _siso(lambda s: g1(s) * g2(s)))


def parallel_case() -> StructuralCase:
    b = DiagramBuilder()
    u, y = _source_and_scope(b)
    b.add("g1", "TransferFunction", numerator=[1.0], denominator=[1.0, 1.0])
    b.add("g2", "TransferFunction", numerator=[3.0], denominator=[1.0, 2.0])
    b.add("sum", "Sum", signs=["+", "+"])
    b.link(u, "g1")
    b.link(u, "g2")
    b.link("g1", "sum", into="in1")
    b.link("g2", "sum", into="in2")
    b.link("sum", y)
    g1, g2 = _tf([1.0], [1.0, 1.0]), _tf([3.0], [1.0, 2.0])
    return StructuralCase("parallel", b.build(), _siso(lambda s: g1(s) + g2(s)))


def branching_case() -> StructuralCase:
    b = DiagramBuilder()
    u = b.add("u", "StepInput", amplitude=1.0, t0=0.0)
    b.add("lag", "FirstOrderLag", k=2.0, T=0.5, y0=0.0)
    b.add("gain", "Gain", k=4.0)
    b.add("scope_y1", "Scope", label="y1")
    b.add("scope_y2", "Scope", label="y2")
    b.link(u, "lag")
    b.link("lag", "scope_y1")
    b.link("lag", "gain")
    b.link("gain", "scope_y2")
    lag = _tf([2.0], [0.5, 1.0])
    return StructuralCase(
        "branching",
        b.build(),
        lambda s: np.array([[lag(s)], [4.0 * lag(s)]], dtype=complex),
        output_labels=["y1", "y2"],
    )


def negative_feedback_case() -> StructuralCase:
    b = DiagramBuilder()
    u, y = _source_and_scope(b)
    b.add("e", "Sum", signs=["+", "-"])
    b.add("w", "TransferFunction", numerator=[5.0], denominator=[1.0, 2.0, 0.0])
    b.add("h", "Gain", k=0.5)
    b.link(u, "e", into="in1")
    b.link("e", "w")
    b.link("w", y)
    b.link("w", "h")
    b.link("h", "e", into="in2")
    w = _tf([5.0], [1.0, 2.0, 0.0])
    return StructuralCase(
        "negative_feedback", b.build(), _siso(lambda s: w(s) / (1.0 + 0.5 * w(s)))
    )


def positive_feedback_case() -> StructuralCase:
    """W/(1 - W H) with W = 1/(s+2), H = 3 gives the unstable 1/(s-1)."""

    b = DiagramBuilder()
    u, y = _source_and_scope(b)
    b.add("e", "Sum", signs=["+", "+"])
    b.add("w", "TransferFunction", numerator=[1.0], denominator=[1.0, 2.0])
    b.add("h", "Gain", k=3.0)
    b.link(u, "e", into="in1")
    b.link("e", "w")
    b.link("w", y)
    b.link("w", "h")
    b.link("h", "e", into="in2")
    return StructuralCase("positive_feedback", b.build(), _siso(_tf([1.0], [1.0, -1.0])))


def pid_loop_case() -> StructuralCase:
    b = DiagramBuilder()
    u, y = _source_and_scope(b)
    b.add("e", "Sum", signs=["+", "-"])
    b.add("pid", "PIDController", kp=2.0, ki=1.0, kd=0.0, filter_n=20.0)
    b.add("plant", "SecondOrderOscillator", k=1.0, wn=2.0, zeta=0.3, y0=0.0, v0=0.0)
    b.link(u, "e", into="in1")
    b.link("e", "pid")
    b.link("pid", "plant")
    b.link("plant", y)
    b.link("plant", "e", into="in2")
    controller = _tf([2.0, 1.0], [1.0, 0.0])
    plant = _tf([4.0], [1.0, 1.2, 4.0])
    return StructuralCase(
        "pid_loop",
        b.build(),
        _siso(lambda s: controller(s) * plant(s) / (1.0 + controller(s) * plant(s))),
    )


def biproper_loop_case() -> StructuralCase:
    """A loop through a biproper W(s) = (s+2)/(s+1): well-posed, 1 + D = 2."""

    b = DiagramBuilder()
    u, y = _source_and_scope(b)
    b.add("e", "Sum", signs=["+", "-"])
    b.add("w", "TransferFunction", numerator=[1.0, 2.0], denominator=[1.0, 1.0])
    b.link(u, "e", into="in1")
    b.link("e", "w")
    b.link("w", y)
    b.link("w", "e", into="in2")
    return StructuralCase(
        "biproper_loop",
        b.build(),
        _siso(_tf([1.0, 2.0], [2.0, 3.0])),
        supported_by_legacy_compiler=False,
    )


def static_loop_case(k: float = 3.0, signs: tuple[str, str] = ("+", "-")) -> StructuralCase:
    """Purely algebraic loop y = k (u -/+ y)."""

    b = DiagramBuilder()
    u, y = _source_and_scope(b)
    b.add("e", "Sum", signs=list(signs))
    b.add("k", "Gain", k=k)
    b.link(u, "e", into="in1")
    b.link("e", "k")
    b.link("k", y)
    b.link("k", "e", into="in2")
    sign = 1.0 if signs[1] == "-" else -1.0
    return StructuralCase(
        "static_loop",
        b.build(),
        _siso(lambda s: k / (1.0 + sign * k) + 0.0 * s),
        supported_by_legacy_compiler=False,
    )


def _first_order_plant() -> DiagramBuilder:
    inner = DiagramBuilder()
    inner.add("in", "SubsystemInput", port="in")
    inner.add("g", "TransferFunction", numerator=[1.0], denominator=[1.0, 1.0])
    inner.add("out", "SubsystemOutput", port="out")
    inner.link("in", "g")
    inner.link("g", "out")
    return inner


def subsystem_feedback_case() -> StructuralCase:
    b = DiagramBuilder()
    u, y = _source_and_scope(b)
    b.add("e", "Sum", signs=["+", "-"])
    b.add("k", "Gain", k=4.0)
    b.subsystem("plant", _first_order_plant())
    b.link(u, "e", into="in1")
    b.link("e", "k")
    b.link("k", "plant")
    b.link("plant", y)
    b.link("plant", "e", into="in2")
    return StructuralCase("subsystem_feedback", b.build(), _siso(_tf([4.0], [1.0, 5.0])))


def flat_equivalent_of_subsystem_feedback() -> StructuralCase:
    b = DiagramBuilder()
    u, y = _source_and_scope(b)
    b.add("e", "Sum", signs=["+", "-"])
    b.add("k", "Gain", k=4.0)
    b.add("g", "TransferFunction", numerator=[1.0], denominator=[1.0, 1.0])
    b.link(u, "e", into="in1")
    b.link("e", "k")
    b.link("k", "g")
    b.link("g", y)
    b.link("g", "e", into="in2")
    return StructuralCase("flat_subsystem_feedback", b.build(), _siso(_tf([4.0], [1.0, 5.0])))


def two_instances_case(*, with_inner_scopes: bool) -> StructuralCase:
    """Two copies of one subsystem in series must stay independent."""

    def lag_subsystem() -> DiagramBuilder:
        inner = DiagramBuilder()
        inner.add("in", "SubsystemInput", port="in")
        inner.add("lag", "FirstOrderLag", k=1.0, T=1.0, y0=0.0)
        inner.add("out", "SubsystemOutput", port="out")
        inner.link("in", "lag")
        inner.link("lag", "out")
        if with_inner_scopes:
            inner.add("probe", "Scope", label="inner")
            inner.link("lag", "probe")
        return inner

    b = DiagramBuilder()
    u, y = _source_and_scope(b)
    b.subsystem("stage_a", lag_subsystem())
    b.subsystem("stage_b", lag_subsystem())
    b.link(u, "stage_a")
    b.link("stage_a", "stage_b")
    b.link("stage_b", y)
    lag = _tf([1.0], [1.0, 1.0])
    if not with_inner_scopes:
        return StructuralCase("two_instances", b.build(), _siso(lambda s: lag(s) ** 2))
    return StructuralCase(
        "two_instances_with_inner_scopes",
        b.build(),
        lambda s: np.array([[lag(s) ** 2], [lag(s)], [lag(s) ** 2]], dtype=complex),
        output_labels=["y", "stage_a/inner", "stage_b/inner"],
    )


def pass_through_case() -> StructuralCase:
    """SubsystemInput wired straight to SubsystemOutput, nested twice."""

    def wire() -> DiagramBuilder:
        inner = DiagramBuilder()
        inner.add("in", "SubsystemInput", port="in")
        inner.add("out", "SubsystemOutput", port="out")
        inner.link("in", "out")
        return inner

    outer = DiagramBuilder()
    outer.add("in", "SubsystemInput", port="in")
    outer.subsystem("wire", wire())
    outer.add("out", "SubsystemOutput", port="out")
    outer.link("in", "wire")
    outer.link("wire", "out")

    b = DiagramBuilder()
    u, y = _source_and_scope(b)
    b.subsystem("bus", outer)
    b.add("g", "TransferFunction", numerator=[1.0], denominator=[1.0, 1.0])
    b.link(u, "bus")
    b.link("bus", "g")
    b.link("g", y)
    return StructuralCase(
        "pass_through",
        b.build(),
        _siso(_tf([1.0], [1.0, 1.0])),
    )


def nested_feedback_case() -> StructuralCase:
    """Three levels; inner loop inside level 2, outer loop across the boundary.

    L3 = 1/s, L2 = L3/(1 + 2 L3) = 1/(s+2), L1 = 3 L2, closed loop 3/(s+5).
    """

    level3 = DiagramBuilder()
    level3.add("in", "SubsystemInput", port="in")
    level3.add("int", "Integrator", k=1.0, y0=0.0)
    level3.add("out", "SubsystemOutput", port="out")
    level3.link("in", "int")
    level3.link("int", "out")

    level2 = DiagramBuilder()
    level2.add("in", "SubsystemInput", port="in")
    level2.add("e", "Sum", signs=["+", "-"])
    level2.subsystem("core", level3)
    level2.add("h", "Gain", k=2.0)
    level2.add("out", "SubsystemOutput", port="out")
    level2.link("in", "e", into="in1")
    level2.link("e", "core")
    level2.link("core", "out")
    level2.link("core", "h")
    level2.link("h", "e", into="in2")

    level1 = DiagramBuilder()
    level1.add("in", "SubsystemInput", port="in")
    level1.add("k", "Gain", k=3.0)
    level1.subsystem("loop", level2)
    level1.add("out", "SubsystemOutput", port="out")
    level1.link("in", "k")
    level1.link("k", "loop")
    level1.link("loop", "out")

    b = DiagramBuilder()
    u, y = _source_and_scope(b)
    b.add("e", "Sum", signs=["+", "-"])
    b.subsystem("plant", level1)
    b.link(u, "e", into="in1")
    b.link("e", "plant")
    b.link("plant", y)
    b.link("plant", "e", into="in2")
    return StructuralCase("nested_feedback", b.build(), _siso(_tf([3.0], [1.0, 5.0])))


def mimo_subsystem_case() -> StructuralCase:
    """Subsystem with two inputs and two outputs fed by two sources."""

    inner = DiagramBuilder()
    inner.add("a", "SubsystemInput", port="a")
    inner.add("b", "SubsystemInput", port="b")
    inner.add("diff", "Sum", signs=["+", "-"])
    inner.add("lag", "FirstOrderLag", k=1.0, T=0.5, y0=0.0)
    inner.add("twice", "Gain", k=2.0)
    inner.add("p", "SubsystemOutput", port="p")
    inner.add("q", "SubsystemOutput", port="q")
    inner.link("a", "diff", into="in1")
    inner.link("b", "diff", into="in2")
    inner.link("diff", "lag")
    inner.link("lag", "p")
    inner.link("a", "twice")
    inner.link("twice", "q")

    b = DiagramBuilder()
    b.add("u1", "StepInput", amplitude=1.0, t0=0.0)
    b.add("u2", "StepInput", amplitude=1.0, t0=0.0)
    b.subsystem("mix", inner)
    b.add("scope_p", "Scope", label="p")
    b.add("scope_q", "Scope", label="q")
    b.link("u1", "mix", into="a")
    b.link("u2", "mix", into="b")
    b.link("mix", "scope_p", out="p")
    b.link("mix", "scope_q", out="q")
    lag = _tf([1.0], [0.5, 1.0])
    return StructuralCase(
        "mimo_subsystem",
        b.build(),
        lambda s: np.array([[lag(s), -lag(s)], [2.0, 0.0]], dtype=complex),
        output_labels=["p", "q"],
    )


def butterworth_case() -> StructuralCase:
    from app.core.block_specs import butterworth_coefficients

    numerator, denominator = butterworth_coefficients(4, 3.0)
    b = DiagramBuilder()
    u, y = _source_and_scope(b)
    b.add("lpf", "ButterworthLPF", order=4, cutoff_freq=3.0, y0=0.0)
    b.link(u, "lpf")
    b.link("lpf", y)
    return StructuralCase("butterworth", b.build(), _siso(_tf(numerator, denominator)))


def all_cases() -> list[StructuralCase]:
    return [
        series_case(),
        parallel_case(),
        branching_case(),
        negative_feedback_case(),
        positive_feedback_case(),
        pid_loop_case(),
        biproper_loop_case(),
        static_loop_case(),
        subsystem_feedback_case(),
        flat_equivalent_of_subsystem_feedback(),
        two_instances_case(with_inner_scopes=False),
        two_instances_case(with_inner_scopes=True),
        pass_through_case(),
        nested_feedback_case(),
        mimo_subsystem_case(),
        butterworth_case(),
    ]


# Points in the complex plane away from every pole used above.
EVALUATION_POINTS: tuple[complex, ...] = (0.5j, 1.0 + 1.0j, 3.0, -0.3 + 2.5j)


def model_transfer(
    a: np.ndarray, b: np.ndarray, c: np.ndarray, d: np.ndarray, s: complex
) -> np.ndarray:
    n = a.shape[0]
    if n == 0:
        return d.astype(complex)
    return c @ np.linalg.solve(s * np.eye(n) - a, b) + d

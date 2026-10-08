"""Interconnection assembly of (A, B, C, D) and its agreement with the block evaluator."""

from __future__ import annotations

import numpy as np
import pytest

from app.models.diagram import Diagram
from app.simulation.assembly import ModelAssemblyError, assemble_linear_model
from app.simulation.compiler import compile_diagram
from app.simulation.hierarchy import flatten_diagram
from app.tests.structural_cases import (
    EVALUATION_POINTS,
    DiagramBuilder,
    all_cases,
    biproper_loop_case,
    model_transfer,
    static_loop_case,
)
from app.analysis.system import assemble_state_space

# See test_structural_models.py: assembly is exact linear algebra on small,
# well-conditioned matrices.
TRANSFER_RTOL = 1e-10
# Both builders evaluate the same realizations with a different order of
# floating-point operations; agreement is expected to a few ulp.
DIFFERENTIAL_ATOL = 1e-12


def _assemble(diagram: dict):
    return assemble_linear_model(flatten_diagram(Diagram.model_validate(diagram)))


@pytest.mark.parametrize("case", all_cases(), ids=lambda case: case.name)
def test_assembled_model_matches_block_diagram_algebra(case) -> None:
    model = _assemble(case.diagram)

    assert [scope.label for scope in model.scopes] == case.output_labels
    for s in EVALUATION_POINTS:
        np.testing.assert_allclose(
            model_transfer(model.a, model.b, model.c, model.d, s),
            case.transfer(s),
            rtol=TRANSFER_RTOL,
            atol=1e-12,
        )


@pytest.mark.parametrize("case", all_cases(), ids=lambda case: case.name)
def test_matrix_dimensions(case) -> None:
    model = _assemble(case.diagram)
    flat = flatten_diagram(Diagram.model_validate(case.diagram))
    m = sum(block.type == "StepInput" for block in flat.blocks)
    p = sum(block.type == "Scope" for block in flat.blocks)
    n = model.state_dimension

    assert model.a.shape == (n, n)
    assert model.b.shape == (n, m)
    assert model.c.shape == (p, n)
    assert model.d.shape == (p, m)
    assert model.x0.shape == (n,)
    assert len(model.states) == n
    assert len(model.sources) == m


LEGACY_CASES = [case for case in all_cases() if case.supported_by_legacy_compiler]


@pytest.mark.parametrize("case", LEGACY_CASES, ids=lambda case: case.name)
def test_assembly_agrees_with_block_evaluator(case) -> None:
    """Same realizations and state order, so matrices must agree entrywise."""

    diagram = Diagram.model_validate(case.diagram)
    legacy = assemble_state_space(diagram)
    compiled = compile_diagram(diagram)
    model = _assemble(case.diagram)

    for name, matrix in zip("ABCD", (model.a, model.b, model.c, model.d)):
        expected = np.asarray(legacy["matrices"][name], dtype=float).reshape(matrix.shape)
        np.testing.assert_allclose(matrix, expected, rtol=0.0, atol=DIFFERENTIAL_ATOL, err_msg=name)
    np.testing.assert_array_equal(model.x0, compiled.initial_state)
    assert [entry.label for entry in model.states] == legacy["state_labels"]

    # Right-hand sides and Scope readings at arbitrary states and times,
    # including times before and after the step instants.
    rng = np.random.default_rng(7)
    for t in (-1.0, 0.0, 0.7, 5.0):
        x = rng.normal(size=model.state_dimension)
        np.testing.assert_allclose(model.rhs(t, x), compiled.rhs(t, x), atol=1e-12)
        legacy_outputs = compiled.evaluate_scopes(t, x)
        np.testing.assert_allclose(
            model.outputs(t, x),
            [legacy_outputs[scope.label] for scope in model.scopes],
            atol=1e-12,
        )


def test_biproper_loop_matrices_by_hand() -> None:
    """W = (s+2)/(s+1) = 1 + 1/(s+1): x' = -x + e, w = x + e, e = u - w.

    Then w = (x + u)/2, x' = -1.5 x + 0.5 u: A = -1.5, B = 0.5, C = D = 0.5.
    """

    model = _assemble(biproper_loop_case().diagram)

    np.testing.assert_allclose(model.a, [[-1.5]], atol=1e-15)
    np.testing.assert_allclose(model.b, [[0.5]], atol=1e-15)
    np.testing.assert_allclose(model.c, [[0.5]], atol=1e-15)
    np.testing.assert_allclose(model.d, [[0.5]], atol=1e-15)
    assert len(model.algebraic_loops) == 1
    assert model.algebraic_loops[0].blocks == ["e", "w"]


def test_static_loop_reports_its_sensitivity() -> None:
    model = _assemble(static_loop_case(k=3.0).diagram)

    assert model.state_dimension == 0
    np.testing.assert_allclose(model.d, [[0.75]], atol=1e-15)
    # Loop outputs (e, k): e = u - k_out, k_out = 3 e, so G = [[0, -1], [3, 0]].
    g = np.array([[0.0, -1.0], [3.0, 0.0]])
    expected = (1.0 + np.linalg.norm(g, 2)) / np.linalg.svd(np.eye(2) - g, compute_uv=False)[-1]
    assert model.algebraic_loops[0].condition_number == pytest.approx(expected)


def _assembly_errors(diagram: dict) -> str:
    with pytest.raises(ModelAssemblyError) as excinfo:
        _assemble(diagram)
    return " ".join(excinfo.value.errors)


def test_singular_algebraic_loop_is_rejected() -> None:
    assert "вырождена" in _assembly_errors(static_loop_case(k=1.0, signs=("+", "+")).diagram)


def test_ill_conditioned_algebraic_loop_is_rejected() -> None:
    # sigma_min(I - G) ~ 1e-9 while ||G|| ~ 1: kappa ~ 1e9 > 1/sqrt(eps) ~ 6.7e7.
    message = _assembly_errors(static_loop_case(k=1.0 - 1e-9, signs=("+", "+")).diagram)
    assert "плохо обусловлена" in message


def test_moderately_conditioned_loop_is_accepted() -> None:
    k = 0.999
    model = _assemble(static_loop_case(k=k, signs=("+", "+")).diagram)
    np.testing.assert_allclose(model.d, [[k / (1.0 - k)]], rtol=1e-12)


def test_long_chain_of_large_gains_is_not_a_loop() -> None:
    b = DiagramBuilder()
    previous = b.add("u", "StepInput", amplitude=1.0, t0=0.0)
    for index in range(6):
        current = b.add(f"k{index}", "Gain", k=1e4)
        b.link(previous, current)
        previous = current
    b.add("y", "Scope", label="y")
    b.link(previous, "y")

    model = _assemble(b.build())

    assert model.algebraic_loops == []
    np.testing.assert_allclose(model.d, [[1e24]], rtol=1e-14)


def test_sources_drive_rhs_according_to_step_times() -> None:
    b = DiagramBuilder()
    b.add("u", "StepInput", amplitude=2.5, t0=1.0)
    b.add("i", "Integrator", k=1.0, y0=0.0)
    b.add("y", "Scope", label="y")
    b.link("u", "i")
    b.link("i", "y")
    model = _assemble(b.build())

    assert model.rhs(0.999, np.zeros(1))[0] == 0.0
    assert model.rhs(1.0, np.zeros(1))[0] == 2.5
    assert model.step_breakpoints(0.0, 10.0) == [1.0]

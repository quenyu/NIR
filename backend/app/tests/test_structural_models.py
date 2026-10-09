"""Compiled models of reference diagrams against block-diagram algebra.

The transfer matrix C (sI - A)^-1 B + D does not depend on the state basis,
so it checks a model builder without fixing the order of states. Assembly is
pure linear algebra on small, well-conditioned matrices; rounding errors stay
at a few ulp times the condition number of (sI - A), hence the relative
tolerance of 1e-10.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.tests.reference_evaluator import compile_diagram, probe_state_space
from app.models.diagram import Diagram
from app.tests.structural_cases import EVALUATION_POINTS, all_cases, model_transfer

TRANSFER_RTOL = 1e-10

LEGACY_CASES = [case for case in all_cases() if case.supported_by_legacy_compiler]


def _legacy_model(diagram: dict) -> tuple:
    probed = probe_state_space(compile_diagram(Diagram.model_validate(diagram)))
    return probed["A"], probed["B"], probed["C"], probed["D"], probed["output_labels"]


@pytest.mark.parametrize("case", LEGACY_CASES, ids=lambda case: case.name)
def test_legacy_compiler_matches_block_diagram_algebra(case) -> None:
    a, b, c, d, labels = _legacy_model(case.diagram)

    assert labels == case.output_labels
    for s in EVALUATION_POINTS:
        expected = case.transfer(s)
        actual = model_transfer(a, b, c, d, s)
        assert actual.shape == expected.shape
        np.testing.assert_allclose(actual, expected, rtol=TRANSFER_RTOL, atol=1e-12)

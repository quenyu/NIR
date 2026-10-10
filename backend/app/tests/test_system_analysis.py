from __future__ import annotations

import pytest

from app.models.diagram import Diagram
from app.tests.helpers import analyze, closed_loop_dynamic_diagram, first_order_step_diagram


def test_first_order_diagram_is_assembled_into_state_space() -> None:
    diagram = Diagram.model_validate(first_order_step_diagram())

    analysis = analyze(diagram)

    assert analysis["state_dimension"] == 1
    assert analysis["input_dimension"] == 1
    assert analysis["output_dimension"] == 1
    assert analysis["matrices"]["A"][0][0] == pytest.approx(-2.0)
    assert analysis["matrices"]["B"][0][0] == pytest.approx(4.0)
    assert analysis["matrices"]["C"][0][0] == pytest.approx(1.0)
    assert analysis["matrices"]["D"][0][0] == pytest.approx(0.0)
    assert analysis["stability"] == "stable"
    assert analysis["characteristic_polynomial"] == pytest.approx([1.0, 2.0])
    assert analysis["spectral_abscissa"] == pytest.approx(-2.0)
    assert analysis["stability_degree"] == pytest.approx(2.0)
    for key in ("controllability", "observability"):
        assert analysis[key]["rank"] == 1
        assert analysis[key]["full_rank"] is True
        assert analysis[key]["method"] == "pbh"


def test_closed_loop_feedback_is_included_in_global_a_matrix() -> None:
    diagram = Diagram.model_validate(closed_loop_dynamic_diagram())

    analysis = analyze(diagram)

    assert analysis["matrices"]["A"][0][0] == pytest.approx(-2.5)
    assert analysis["matrices"]["B"][0][0] == pytest.approx(1.25)
    assert analysis["poles"][0]["real"] == pytest.approx(-2.5)
    assert analysis["stability"] == "stable"

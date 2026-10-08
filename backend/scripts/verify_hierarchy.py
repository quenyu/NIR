from __future__ import annotations

import json

import numpy as np

from app.analysis.system import assemble_state_space
from app.examples.hierarchical_scenarios import SCENARIOS
from app.models.api import SimulationRequest
from app.models.diagram import Diagram
from app.simulation.hierarchy import flatten_diagram
from app.simulation.service import simulate_request
from app.validation.validator import validate_diagram


def main() -> None:
    report: dict[str, object] = {"passed": True, "scenarios": {}}
    scenario_results: dict[str, object] = {}

    for name, build_scenario in SCENARIOS.items():
        diagram = Diagram.model_validate(build_scenario())
        errors = validate_diagram(diagram)
        if errors:
            raise RuntimeError(f"{name}: {'; '.join(errors)}")

        flattened = flatten_diagram(diagram)
        analysis = assemble_state_space(diagram)
        flat_analysis = assemble_state_space(flattened)
        matrices_match = all(
            np.allclose(
                analysis["matrices"][matrix_name],
                flat_analysis["matrices"][matrix_name],
            )
            for matrix_name in ("A", "B", "C", "D")
        )
        if not matrices_match:
            raise RuntimeError(f"{name}: иерархическая и плоская модели не совпали")

        simulation = simulate_request(
            SimulationRequest(
                diagram=diagram,
                t_start=0.0,
                t_end=8.0,
                dt=0.02,
                solver="rk4",
            )
        )
        output = np.asarray(simulation.outputs["y"], dtype=float)
        if not np.isfinite(output).all():
            raise RuntimeError(f"{name}: переходная характеристика содержит NaN/Inf")

        scenario_results[name] = {
            "root_blocks": len(diagram.blocks),
            "flattened_blocks": len(flattened.blocks),
            "flattened_ids": [block.id for block in flattened.blocks],
            "state_dimension": analysis["state_dimension"],
            "state_labels": analysis["state_labels"],
            "matrices": analysis["matrices"],
            "poles": analysis["poles"],
            "stability": analysis["stability"],
            "controllability": analysis["controllability"],
            "observability": analysis["observability"],
            "hierarchical_equals_flat": matrices_match,
            "response": {
                "samples": int(output.size),
                "initial": float(output[0]),
                "final": float(output[-1]),
                "maximum": float(np.max(output)),
            },
        }

    report["scenarios"] = scenario_results
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()


from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.experiments.reference_models import (
    butterworth_lpf_step_response,
    first_order_step_response,
    integrator_step_response,
    underdamped_second_order_step_response,
)
from app.models.diagram import Diagram

REPO_ROOT = Path(__file__).resolve().parents[3]
EXAMPLES_DIR = REPO_ROOT / "examples"
DEFAULT_DT_SWEEP: tuple[float, ...] = (0.2, 0.1, 0.05, 0.02, 0.01, 0.005)
BENCHMARK_SCENARIO_SLUG = "second_order_oscillator"


@dataclass(frozen=True)
class ScenarioSpec:
    slug: str
    title: str
    description: str
    diagram_path: Path
    t_end: float
    default_dt: float
    scope_label: str
    reference_fn: Callable[[np.ndarray], np.ndarray]
    parameter_block_id: str
    parameter_name: str
    parameter_nominal: float

    def load_diagram(self) -> Diagram:
        return Diagram.model_validate(json.loads(self.diagram_path.read_text(encoding="utf-8")))

    def reference(self, time: np.ndarray | list[float]) -> np.ndarray:
        return self.reference_fn(np.asarray(time, dtype=float))

    def as_dict(self) -> dict[str, str | float]:
        return {
            "slug": self.slug,
            "title": self.title,
            "description": self.description,
            "diagram_path": self.diagram_path.relative_to(REPO_ROOT).as_posix(),
            "t_end": self.t_end,
            "default_dt": self.default_dt,
            "scope_label": self.scope_label,
        }


def build_scenarios() -> list[ScenarioSpec]:
    return [
        ScenarioSpec(
            slug="integrator",
            title="Интегратор с единичным входом",
            description="Идеальный интегратор под действием единичного ступенчатого сигнала.",
            diagram_path=EXAMPLES_DIR / "integrator_step.json",
            t_end=3.0,
            default_dt=0.01,
            scope_label="y",
            reference_fn=lambda time: integrator_step_response(time, k=1.0, amplitude=1.0, y0=0.0),
            parameter_block_id="int1",
            parameter_name="k",
            parameter_nominal=1.0,
        ),
        ScenarioSpec(
            slug="first_order_lag",
            title="Апериодическое звено 1-го порядка",
            description="FirstOrderLag с k=2.0, T=0.5 на единичный скачок.",
            diagram_path=EXAMPLES_DIR / "first_order_lag_step.json",
            t_end=4.0,
            default_dt=0.01,
            scope_label="y",
            reference_fn=lambda time: first_order_step_response(
                time,
                k=2.0,
                t_const=0.5,
                amplitude=1.0,
                y0=0.0,
            ),
            parameter_block_id="lag1",
            parameter_name="T",
            parameter_nominal=0.5,
        ),
        ScenarioSpec(
            slug="second_order_oscillator",
            title="Колебательное звено 2-го порядка",
            description="SecondOrderOscillator с k=1.5, wn=3.0, zeta=0.2 на единичный скачок.",
            diagram_path=EXAMPLES_DIR / "second_order_oscillator_step.json",
            t_end=6.0,
            default_dt=0.005,
            scope_label="y",
            reference_fn=lambda time: underdamped_second_order_step_response(
                time,
                k=1.5,
                wn=3.0,
                zeta=0.2,
                amplitude=1.0,
            ),
            parameter_block_id="osc1",
            parameter_name="zeta",
            parameter_nominal=0.2,
        ),
        ScenarioSpec(
            slug="butterworth_lpf",
            title="ФНЧ Баттерворта 2-го порядка",
            description="ButterworthLPF с order=2, cutoff_freq=10 рад/с на единичный скачок.",
            diagram_path=EXAMPLES_DIR / "butterworth_lpf_step.json",
            t_end=2.0,
            default_dt=0.001,
            scope_label="y",
            reference_fn=lambda time: butterworth_lpf_step_response(
                time,
                order=2,
                cutoff_freq=10.0,
                amplitude=1.0,
            ),
            parameter_block_id="bw1",
            parameter_name="cutoff_freq",
            parameter_nominal=10.0,
        ),
    ]

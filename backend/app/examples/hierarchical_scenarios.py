from __future__ import annotations

from collections.abc import Callable
from typing import Any

DiagramData = dict[str, Any]


def _block(
    block_id: str,
    block_type: str,
    parameters: dict[str, Any] | None = None,
    input_ports: list[str] | None = None,
    output_ports: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "id": block_id,
        "type": block_type,
        "parameters": parameters or {},
        "input_ports": ["in"] if input_ports is None else input_ports,
        "output_ports": ["out"] if output_ports is None else output_ports,
    }


def _connection(
    source: str,
    target: str,
    target_port: str = "in",
    source_port: str = "out",
) -> dict[str, str]:
    return {
        "from_block": source,
        "from_port": source_port,
        "to_block": target,
        "to_port": target_port,
    }


def _interface_input(block_id: str = "input", port: str = "in") -> dict[str, Any]:
    return _block(block_id, "SubsystemInput", {"port": port}, [], ["out"])


def _interface_output(block_id: str = "output", port: str = "out") -> dict[str, Any]:
    return _block(block_id, "SubsystemOutput", {"port": port}, ["in"], [])


def _subsystem(
    block_id: str,
    diagram: DiagramData,
    input_ports: list[str] | None = None,
    output_ports: list[str] | None = None,
) -> dict[str, Any]:
    return _block(
        block_id,
        "Subsystem",
        {"diagram": diagram},
        ["in"] if input_ports is None else input_ports,
        ["out"] if output_ports is None else output_ports,
    )


def _wrap_single(core: dict[str, Any]) -> DiagramData:
    return {
        "blocks": [_interface_input(), core, _interface_output()],
        "connections": [
            _connection("input", core["id"]),
            _connection(core["id"], "output"),
        ],
    }


def _root(inner_id: str, inner: DiagramData) -> DiagramData:
    return {
        "blocks": [
            _block(
                "step",
                "StepInput",
                {"amplitude": 1.0, "t0": 0.0},
                [],
                ["out"],
            ),
            _subsystem(inner_id, inner),
            _block("scope", "Scope", {"label": "y"}, ["in"], []),
        ],
        "connections": [
            _connection("step", inner_id),
            _connection(inner_id, "scope"),
        ],
    }


def two_level_plant() -> DiagramData:
    """Root scheme -> plant subsystem -> first-order dynamic block."""

    plant = {
        "blocks": [
            _interface_input(),
            _block("lag", "FirstOrderLag", {"k": 2.0, "T": 0.5, "y0": 0.0}),
            _interface_output(),
        ],
        "connections": [
            _connection("input", "lag"),
            _connection("lag", "output"),
        ],
    }
    return _root("plant", plant)


def three_level_cascade() -> DiagramData:
    """Root scheme -> cascade subsystem -> nested fast-stage subsystem."""

    fast_stage = {
        "blocks": [
            _interface_input(),
            _block(
                "lag_fast",
                "FirstOrderLag",
                {"k": 1.5, "T": 0.25, "y0": 0.0},
            ),
            _interface_output(),
        ],
        "connections": [
            _connection("input", "lag_fast"),
            _connection("lag_fast", "output"),
        ],
    }
    cascade = {
        "blocks": [
            _interface_input(),
            _subsystem("fast_stage", fast_stage),
            _block(
                "lag_slow",
                "FirstOrderLag",
                {"k": 0.8, "T": 0.6, "y0": 0.0},
            ),
            _interface_output(),
        ],
        "connections": [
            _connection("input", "fast_stage"),
            _connection("fast_stage", "lag_slow"),
            _connection("lag_slow", "output"),
        ],
    }
    return _root("cascade", cascade)


def hierarchical_closed_loop() -> DiagramData:
    """Closed loop with separate controller, plant and nested actuator subsystems."""

    controller = {
        "blocks": [
            _interface_input(),
            _block("gain", "Gain", {"k": 2.0}),
            _interface_output(),
        ],
        "connections": [
            _connection("input", "gain"),
            _connection("gain", "output"),
        ],
    }
    actuator = {
        "blocks": [
            _interface_input(),
            _block(
                "actuator_lag",
                "FirstOrderLag",
                {"k": 1.0, "T": 0.2, "y0": 0.0},
            ),
            _interface_output(),
        ],
        "connections": [
            _connection("input", "actuator_lag"),
            _connection("actuator_lag", "output"),
        ],
    }
    plant = {
        "blocks": [
            _interface_input(),
            _subsystem("actuator", actuator),
            _block(
                "oscillator",
                "SecondOrderOscillator",
                {"k": 1.0, "wn": 2.5, "zeta": 0.55, "y0": 0.0, "v0": 0.0},
            ),
            _interface_output(),
        ],
        "connections": [
            _connection("input", "actuator"),
            _connection("actuator", "oscillator"),
            _connection("oscillator", "output"),
        ],
    }
    return {
        "blocks": [
            _block(
                "reference",
                "StepInput",
                {"amplitude": 1.0, "t0": 0.0},
                [],
                ["out"],
            ),
            _block("error", "Sum", {"signs": ["+", "-"]}, ["in1", "in2"], ["out"]),
            _subsystem("controller", controller),
            _subsystem("plant", plant),
            _block("scope", "Scope", {"label": "y"}, ["in"], []),
        ],
        "connections": [
            _connection("reference", "error", "in1"),
            _connection("error", "controller"),
            _connection("controller", "plant"),
            _connection("plant", "scope"),
            _connection("plant", "error", "in2"),
        ],
    }


def compact_five_subsystem_chain() -> DiagramData:
    """Five compact root blocks with a four-level measurement hierarchy."""

    reference = {
        "blocks": [
            _block("step", "StepInput", {"amplitude": 1.0, "t0": 0.0}, [], ["out"]),
            _interface_output(),
        ],
        "connections": [_connection("step", "output")],
    }
    controller = _wrap_single(
        _block(
            "pid",
            "PIDController",
            {"kp": 2.4, "ki": 1.1, "kd": 0.08, "filter_n": 20.0},
        )
    )
    drive = _wrap_single(
        _block("drive_lag", "FirstOrderLag", {"k": 1.0, "T": 0.12, "y0": 0.0})
    )
    motor = _wrap_single(
        _block(
            "motor_model",
            "SecondOrderOscillator",
            {"k": 1.0, "wn": 3.2, "zeta": 0.62, "y0": 0.0, "v0": 0.0},
        )
    )

    signal_filter = _wrap_single(
        _block("filter", "FirstOrderLag", {"k": 1.0, "T": 0.05, "y0": 0.0})
    )
    adc_stage = _wrap_single(_subsystem("signal_filter", signal_filter))
    sensor_path = _wrap_single(_subsystem("adc_stage", adc_stage))
    measurement = {
        "blocks": [
            _interface_input(),
            _subsystem("sensor_path", sensor_path),
            _block("scope", "Scope", {"label": "y"}, ["in"], []),
        ],
        "connections": [
            _connection("input", "sensor_path"),
            _connection("sensor_path", "scope"),
        ],
    }

    return {
        "blocks": [
            _subsystem("reference", reference, [], ["out"]),
            _subsystem("controller", controller),
            _subsystem("drive", drive),
            _subsystem("motor", motor),
            _subsystem("measurement", measurement, ["in"], []),
        ],
        "connections": [
            _connection("reference", "controller"),
            _connection("controller", "drive"),
            _connection("drive", "motor"),
            _connection("motor", "measurement"),
        ],
    }


SCENARIOS: dict[str, Callable[[], DiagramData]] = {
    "two_level_plant": two_level_plant,
    "three_level_cascade": three_level_cascade,
    "hierarchical_closed_loop": hierarchical_closed_loop,
    "compact_five_subsystem_chain": compact_five_subsystem_chain,
}

from __future__ import annotations

from typing import Any

KNOWN_BLOCK_TYPES = {
    "StepInput",
    "Gain",
    "Sum",
    "Integrator",
    "FirstOrderLag",
    "SecondOrderOscillator",
    "Scope",
}

DYNAMIC_BLOCK_TYPES = {"Integrator", "FirstOrderLag", "SecondOrderOscillator"}

DEFAULT_PARAMETERS: dict[str, dict[str, Any]] = {
    "StepInput": {"amplitude": 1.0, "t0": 0.0},
    "Gain": {"k": 1.0},
    "Sum": {"signs": ["+", "-"]},
    "Integrator": {"k": 1.0, "y0": 0.0},
    "FirstOrderLag": {"k": 1.0, "T": 1.0, "y0": 0.0},
    "SecondOrderOscillator": {"k": 1.0, "wn": 1.0, "zeta": 0.2, "y0": 0.0, "v0": 0.0},
    "Scope": {"label": ""},
}


def get_signs(parameters: dict[str, Any]) -> list[str]:
    raw = parameters.get("signs", DEFAULT_PARAMETERS["Sum"]["signs"])
    if not isinstance(raw, list):
        return []
    return [str(item) for item in raw]


def expected_input_ports(block_type: str, parameters: dict[str, Any]) -> list[str]:
    if block_type == "StepInput":
        return []
    if block_type in {"Gain", "Integrator", "FirstOrderLag", "SecondOrderOscillator", "Scope"}:
        return ["in"]
    if block_type == "Sum":
        signs = get_signs(parameters)
        if not signs:
            return []
        return [f"in{i + 1}" for i in range(len(signs))]
    return []


def expected_output_ports(block_type: str, _: dict[str, Any]) -> list[str]:
    if block_type == "Scope":
        return []
    if block_type in KNOWN_BLOCK_TYPES:
        return ["out"]
    return []


def get_numeric_parameter(parameters: dict[str, Any], key: str, default: float) -> float:
    value = parameters.get(key, default)
    if isinstance(value, bool):
        raise ValueError(f"Параметр '{key}' должен быть числом, а не булевым значением.")
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Параметр '{key}' должен быть числом.") from exc


def get_string_parameter(parameters: dict[str, Any], key: str, default: str = "") -> str:
    value = parameters.get(key, default)
    if value is None:
        return default
    return str(value)


def validate_parameters(block_type: str, parameters: dict[str, Any]) -> list[str]:
    errors: list[str] = []

    try:
        if block_type == "StepInput":
            get_numeric_parameter(parameters, "amplitude", DEFAULT_PARAMETERS["StepInput"]["amplitude"])
            get_numeric_parameter(parameters, "t0", DEFAULT_PARAMETERS["StepInput"]["t0"])

        elif block_type == "Gain":
            get_numeric_parameter(parameters, "k", DEFAULT_PARAMETERS["Gain"]["k"])

        elif block_type == "Integrator":
            get_numeric_parameter(parameters, "k", DEFAULT_PARAMETERS["Integrator"]["k"])
            get_numeric_parameter(parameters, "y0", DEFAULT_PARAMETERS["Integrator"]["y0"])

        elif block_type == "FirstOrderLag":
            get_numeric_parameter(parameters, "k", DEFAULT_PARAMETERS["FirstOrderLag"]["k"])
            t_const = get_numeric_parameter(parameters, "T", DEFAULT_PARAMETERS["FirstOrderLag"]["T"])
            get_numeric_parameter(parameters, "y0", DEFAULT_PARAMETERS["FirstOrderLag"]["y0"])
            if t_const <= 0.0:
                errors.append("Параметр 'T' должен быть больше 0.")

        elif block_type == "SecondOrderOscillator":
            get_numeric_parameter(parameters, "k", DEFAULT_PARAMETERS["SecondOrderOscillator"]["k"])
            wn = get_numeric_parameter(parameters, "wn", DEFAULT_PARAMETERS["SecondOrderOscillator"]["wn"])
            zeta = get_numeric_parameter(
                parameters, "zeta", DEFAULT_PARAMETERS["SecondOrderOscillator"]["zeta"]
            )
            get_numeric_parameter(parameters, "y0", DEFAULT_PARAMETERS["SecondOrderOscillator"]["y0"])
            get_numeric_parameter(parameters, "v0", DEFAULT_PARAMETERS["SecondOrderOscillator"]["v0"])
            if wn <= 0.0:
                errors.append("Параметр 'wn' должен быть больше 0.")
            if zeta < 0.0:
                errors.append("Параметр 'zeta' должен быть >= 0.")

        elif block_type == "Sum":
            signs = get_signs(parameters)
            if not signs:
                errors.append("Параметр 'signs' должен быть непустым списком.")
            invalid = [sign for sign in signs if sign not in {"+", "-"}]
            if invalid:
                errors.append("Параметр 'signs' может содержать только '+' и '-'.")

        elif block_type == "Scope":
            get_string_parameter(parameters, "label", "")

    except ValueError as exc:
        errors.append(str(exc))

    return errors

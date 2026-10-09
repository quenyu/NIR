from __future__ import annotations

import cmath
import math
from typing import Any

KNOWN_BLOCK_TYPES = {
    "StepInput",
    "Gain",
    "Sum",
    "Integrator",
    "FirstOrderLag",
    "SecondOrderOscillator",
    "TransferFunction",
    "ButterworthLPF",
    "PIDController",
    "Subsystem",
    "SubsystemInput",
    "SubsystemOutput",
    "Scope",
}

DYNAMIC_BLOCK_TYPES = {
    "Integrator",
    "FirstOrderLag",
    "SecondOrderOscillator",
    "TransferFunction",
    "ButterworthLPF",
    "PIDController",
}

DEFAULT_PARAMETERS: dict[str, dict[str, Any]] = {
    "StepInput": {"amplitude": 1.0, "t0": 0.0},
    "Gain": {"k": 1.0},
    "Sum": {"signs": ["+", "-"]},
    "Integrator": {"k": 1.0, "y0": 0.0},
    "FirstOrderLag": {"k": 1.0, "T": 1.0, "y0": 0.0},
    "SecondOrderOscillator": {"k": 1.0, "wn": 1.0, "zeta": 0.2, "y0": 0.0, "v0": 0.0},
    "TransferFunction": {"numerator": [1.0], "denominator": [1.0, 1.0]},
    "ButterworthLPF": {"order": 2, "cutoff_freq": 10.0, "y0": 0.0},
    "PIDController": {"kp": 1.0, "ki": 0.0, "kd": 0.0, "filter_n": 20.0},
    "Subsystem": {
        "diagram": {
            "blocks": [
                {
                    "id": "input",
                    "type": "SubsystemInput",
                    "parameters": {"port": "in"},
                    "input_ports": [],
                    "output_ports": ["out"],
                },
                {
                    "id": "gain",
                    "type": "Gain",
                    "parameters": {"k": 1.0},
                    "input_ports": ["in"],
                    "output_ports": ["out"],
                },
                {
                    "id": "output",
                    "type": "SubsystemOutput",
                    "parameters": {"port": "out"},
                    "input_ports": ["in"],
                    "output_ports": [],
                },
            ],
            "connections": [
                {
                    "from_block": "input",
                    "from_port": "out",
                    "to_block": "gain",
                    "to_port": "in",
                },
                {
                    "from_block": "gain",
                    "from_port": "out",
                    "to_block": "output",
                    "to_port": "in",
                },
            ],
        }
    },
    "SubsystemInput": {"port": "in"},
    "SubsystemOutput": {"port": "out"},
    "Scope": {"label": ""},
}


def _subsystem_interface_ports(parameters: dict[str, Any], block_type: str) -> list[str]:
    raw_diagram = parameters.get("diagram")
    if not isinstance(raw_diagram, dict):
        return []
    raw_blocks = raw_diagram.get("blocks")
    if not isinstance(raw_blocks, list):
        return []
    ports: list[str] = []
    for raw_block in raw_blocks:
        if not isinstance(raw_block, dict) or raw_block.get("type") != block_type:
            continue
        raw_parameters = raw_block.get("parameters", {})
        if not isinstance(raw_parameters, dict):
            continue
        port = str(raw_parameters.get("port", "")).strip()
        if port:
            ports.append(port)
    return ports


def get_signs(parameters: dict[str, Any]) -> list[str]:
    raw = parameters.get("signs", DEFAULT_PARAMETERS["Sum"]["signs"])
    if not isinstance(raw, list):
        return []
    return [str(item) for item in raw]


def expected_input_ports(block_type: str, parameters: dict[str, Any]) -> list[str]:
    if block_type in {"StepInput", "SubsystemInput"}:
        return []
    if block_type in {
        "Gain",
        "Integrator",
        "FirstOrderLag",
        "SecondOrderOscillator",
        "TransferFunction",
        "ButterworthLPF",
        "PIDController",
        "Scope",
        "SubsystemOutput",
    }:
        return ["in"]
    if block_type == "Subsystem":
        return _subsystem_interface_ports(parameters, "SubsystemInput")
    if block_type == "Sum":
        signs = get_signs(parameters)
        if not signs:
            return []
        return [f"in{i + 1}" for i in range(len(signs))]
    return []


def expected_output_ports(block_type: str, parameters: dict[str, Any]) -> list[str]:
    if block_type in {"Scope", "SubsystemOutput"}:
        return []
    if block_type == "Subsystem":
        return _subsystem_interface_ports(parameters, "SubsystemOutput")
    if block_type in KNOWN_BLOCK_TYPES:
        return ["out"]
    return []


def get_numeric_parameter(parameters: dict[str, Any], key: str, default: float) -> float:
    value = parameters.get(key, default)
    if isinstance(value, bool):
        raise ValueError(f"Параметр '{key}' должен быть числом, а не булевым значением.")
    try:
        numeric_value = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Параметр '{key}' должен быть числом.") from exc
    if not math.isfinite(numeric_value):
        raise ValueError(f"Параметр '{key}' должен быть конечным числом.")
    return numeric_value


def get_numeric_vector_parameter(
    parameters: dict[str, Any],
    key: str,
    default: list[float],
) -> list[float]:
    value = parameters.get(key, default)
    if not isinstance(value, list):
        raise ValueError(f"Parameter '{key}' must be a list of numbers.")
    if not value:
        raise ValueError(f"Parameter '{key}' must not be empty.")

    coefficients: list[float] = []
    for index, item in enumerate(value):
        if isinstance(item, bool):
            raise ValueError(f"Parameter '{key}[{index}]' must be a finite number.")
        try:
            coefficient = float(item)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Parameter '{key}[{index}]' must be a finite number.") from exc
        if not math.isfinite(coefficient):
            raise ValueError(f"Parameter '{key}[{index}]' must be a finite number.")
        coefficients.append(coefficient)
    return coefficients


def polynomial_order(coefficients: list[float]) -> int:
    for index, coefficient in enumerate(coefficients):
        if coefficient != 0.0:
            return len(coefficients) - index - 1
    return 0


def get_transfer_function_coefficients(
    parameters: dict[str, Any],
) -> tuple[list[float], list[float]]:
    numerator = get_numeric_vector_parameter(
        parameters,
        "numerator",
        DEFAULT_PARAMETERS["TransferFunction"]["numerator"],
    )
    denominator = get_numeric_vector_parameter(
        parameters,
        "denominator",
        DEFAULT_PARAMETERS["TransferFunction"]["denominator"],
    )
    return numerator, denominator


def get_pid_coefficients(parameters: dict[str, Any]) -> tuple[list[float], list[float]]:
    kp = get_numeric_parameter(parameters, "kp", DEFAULT_PARAMETERS["PIDController"]["kp"])
    ki = get_numeric_parameter(parameters, "ki", DEFAULT_PARAMETERS["PIDController"]["ki"])
    kd = get_numeric_parameter(parameters, "kd", DEFAULT_PARAMETERS["PIDController"]["kd"])
    filter_n = get_numeric_parameter(
        parameters,
        "filter_n",
        DEFAULT_PARAMETERS["PIDController"]["filter_n"],
    )
    if filter_n <= 0.0:
        raise ValueError("Параметр 'filter_n' должен быть больше 0.")

    has_i = abs(ki) > 1e-15
    has_d = abs(kd) > 1e-15
    if has_i and has_d:
        return (
            [kp + kd * filter_n, kp * filter_n + ki, ki * filter_n],
            [1.0, filter_n, 0.0],
        )
    if has_d:
        return [kp + kd * filter_n, kp * filter_n], [1.0, filter_n]
    if has_i:
        return [kp, ki], [1.0, 0.0]
    return [kp], [1.0]


def transfer_function_denominator_order(parameters: dict[str, Any]) -> int:
    _, denominator = get_transfer_function_coefficients(parameters)
    return len(denominator) - 1


def is_dynamic_block(block_type: str, parameters: dict[str, Any]) -> bool:
    if block_type in {"Integrator", "FirstOrderLag", "SecondOrderOscillator", "ButterworthLPF"}:
        return True
    if block_type == "TransferFunction":
        try:
            return transfer_function_denominator_order(parameters) >= 1
        except ValueError:
            return False
    if block_type == "PIDController":
        try:
            _, denominator = get_pid_coefficients(parameters)
            return len(denominator) > 1
        except ValueError:
            return False
    return False


def has_direct_feedthrough(block_type: str, parameters: dict[str, Any]) -> bool:
    if block_type in {"Gain", "Sum"}:
        return True
    if block_type == "ButterworthLPF":
        return False
    if block_type in {"TransferFunction", "PIDController"}:
        try:
            if block_type == "TransferFunction":
                numerator, denominator = get_transfer_function_coefficients(parameters)
            else:
                numerator, denominator = get_pid_coefficients(parameters)
            denominator_order = len(denominator) - 1
            if denominator_order == 0:
                return True
            return polynomial_order(numerator) == denominator_order
        except ValueError:
            return True
    if block_type == "Subsystem":
        # The wrapper is eliminated before algebraic-loop analysis. Returning
        # False here avoids guessing whether a nested path has feedthrough.
        return False
    return False


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

        elif block_type == "TransferFunction":
            numerator, denominator = get_transfer_function_coefficients(parameters)
            if denominator[0] == 0.0:
                errors.append("Параметр 'denominator[0]' не должен быть равен 0.")
            else:
                numerator_order = polynomial_order(numerator)
                denominator_order = len(denominator) - 1
                if numerator_order > denominator_order:
                    errors.append(
                        "Порядок числителя 'numerator' не должен превышать порядок знаменателя."
                    )

        elif block_type == "PIDController":
            get_numeric_parameter(parameters, "kp", DEFAULT_PARAMETERS["PIDController"]["kp"])
            get_numeric_parameter(parameters, "ki", DEFAULT_PARAMETERS["PIDController"]["ki"])
            get_numeric_parameter(parameters, "kd", DEFAULT_PARAMETERS["PIDController"]["kd"])
            get_pid_coefficients(parameters)

        elif block_type == "Sum":
            signs = get_signs(parameters)
            if not signs:
                errors.append("Параметр 'signs' должен быть непустым списком.")
            invalid = [sign for sign in signs if sign not in {"+", "-"}]
            if invalid:
                errors.append("Параметр 'signs' может содержать только '+' и '-'.")

        elif block_type == "ButterworthLPF":
            order_val = get_numeric_parameter(
                parameters, "order", DEFAULT_PARAMETERS["ButterworthLPF"]["order"]
            )
            cutoff = get_numeric_parameter(
                parameters, "cutoff_freq", DEFAULT_PARAMETERS["ButterworthLPF"]["cutoff_freq"]
            )
            get_numeric_parameter(
                parameters, "y0", DEFAULT_PARAMETERS["ButterworthLPF"]["y0"]
            )
            if order_val != int(order_val) or int(order_val) < 1:
                errors.append("Параметр 'order' должен быть целым числом >= 1.")
            elif int(order_val) > 10:
                errors.append("Параметр 'order' не должен превышать 10.")
            if cutoff <= 0.0:
                errors.append("Параметр 'cutoff_freq' должен быть больше 0.")

        elif block_type == "Scope":
            get_string_parameter(parameters, "label", "")
            if "reference" in parameters:
                reference = get_numeric_parameter(parameters, "reference", 0.0)
                if not math.isfinite(reference):
                    errors.append("Параметр 'reference' должен быть конечным числом.")

        elif block_type in {"SubsystemInput", "SubsystemOutput"}:
            port = get_string_parameter(parameters, "port", "").strip()
            if not port:
                errors.append("Параметр 'port' не может быть пустым.")

        elif block_type == "Subsystem":
            raw_diagram = parameters.get("diagram")
            if not isinstance(raw_diagram, dict):
                errors.append("Параметр 'diagram' должен содержать вложенную схему.")
            elif not isinstance(raw_diagram.get("blocks"), list) or not isinstance(
                raw_diagram.get("connections"), list
            ):
                errors.append("Вложенная схема должна содержать списки 'blocks' и 'connections'.")

    except ValueError as exc:
        errors.append(str(exc))

    return errors


def butterworth_coefficients(
    order: int, cutoff_freq: float
) -> tuple[list[float], list[float]]:
    """Вычисляет коэффициенты передаточной функции ФНЧ Баттерворта.

    Передаточная функция: W(s) = wc^n / D(s)
    где D(s) — полином Баттерворта с полюсами в левой полуплоскости,
    масштабированный на частоту среза wc.

    Возвращает (numerator, denominator) — списки коэффициентов полиномов
    от старшей степени к младшей.
    """
    if order < 1:
        raise ValueError("Порядок фильтра Баттерворта должен быть >= 1.")
    if cutoff_freq <= 0.0:
        raise ValueError("Частота среза должна быть > 0.")

    wc = cutoff_freq

    # Полюса прототипа Баттерворта (единичная частота среза)
    poles: list[complex] = []
    for k in range(order):
        angle = math.pi * (2 * k + order + 1) / (2 * order)
        pole = wc * cmath.exp(1j * angle)
        # Берём только полюса из левой полуплоскости (все для Баттерворта)
        poles.append(pole)

    # Перемножаем сомножители (s - p_k) для получения коэффициентов знаменателя
    denominator: list[complex] = [complex(1.0, 0.0)]
    for pole in poles:
        new_den: list[complex] = [complex(0.0, 0.0)] * (len(denominator) + 1)
        for i, coeff in enumerate(denominator):
            new_den[i] += coeff  # умножение на s
            new_den[i + 1] -= coeff * pole  # умножение на (-p_k)
        denominator = new_den

    # Коэффициенты должны быть вещественными
    real_denominator = [c.real for c in denominator]

    # Числитель: wc^n
    numerator = [wc ** order]

    return numerator, real_denominator

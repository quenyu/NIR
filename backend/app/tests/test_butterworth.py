"""Тесты блока ButterworthLPF (ФНЧ Баттерворта)."""
from __future__ import annotations

import math

import numpy as np
import pytest

from app.core.block_specs import (
    butterworth_coefficients,
    validate_parameters,
)
from app.models.api import SimulationRequest
from app.models.diagram import Diagram
from app.simulation.service import simulate_request
from app.tests.helpers import butterworth_lpf_step_diagram
from app.experiments.reference_models import butterworth_lpf_step_response


# ---------------------------------------------------------------------------
# Тесты вычисления коэффициентов Баттерворта
# ---------------------------------------------------------------------------


class TestButterworthCoefficients:
    """Проверка коэффициентов полинома Баттерворта для порядков 1–4."""

    def test_order_1(self) -> None:
        """1-й порядок: W(s) = wc / (s + wc)."""
        wc = 5.0
        num, den = butterworth_coefficients(1, wc)
        assert num == pytest.approx([wc])
        assert len(den) == 2
        assert den[0] == pytest.approx(1.0)
        assert den[1] == pytest.approx(wc)

    def test_order_2(self) -> None:
        """2-й порядок: знаменатель s^2 + sqrt(2)*wc*s + wc^2."""
        wc = 10.0
        num, den = butterworth_coefficients(2, wc)
        assert num == pytest.approx([wc**2])
        assert len(den) == 3
        assert den[0] == pytest.approx(1.0)
        assert den[1] == pytest.approx(math.sqrt(2) * wc, rel=1e-10)
        assert den[2] == pytest.approx(wc**2, rel=1e-10)

    def test_order_3(self) -> None:
        """3-й порядок: знаменатель (s + wc)(s^2 + wc*s + wc^2)."""
        wc = 1.0
        num, den = butterworth_coefficients(3, wc)
        assert num == pytest.approx([wc**3])
        assert len(den) == 4
        assert den[0] == pytest.approx(1.0)
        assert den[1] == pytest.approx(2.0)  # 2*wc для wc=1
        assert den[2] == pytest.approx(2.0)  # 2*wc^2 для wc=1
        assert den[3] == pytest.approx(1.0)  # wc^3

    def test_order_4(self) -> None:
        """4-й порядок: проверяем длину и ведущий коэффициент."""
        wc = 2.0
        num, den = butterworth_coefficients(4, wc)
        assert num == pytest.approx([wc**4])
        assert len(den) == 5
        assert den[0] == pytest.approx(1.0)
        # Свободный член = wc^4
        assert den[4] == pytest.approx(wc**4, rel=1e-10)

    def test_invalid_order(self) -> None:
        with pytest.raises(ValueError, match="Порядок фильтра"):
            butterworth_coefficients(0, 10.0)

    def test_invalid_cutoff(self) -> None:
        with pytest.raises(ValueError, match="Частота среза"):
            butterworth_coefficients(2, 0.0)

    def test_dc_gain_is_unity(self) -> None:
        """Статический коэффициент передачи W(0) = wc^n / D(0) = 1."""
        for order in range(1, 6):
            wc = 7.0
            num, den = butterworth_coefficients(order, wc)
            dc_gain = num[0] / den[-1]
            assert dc_gain == pytest.approx(1.0, rel=1e-10), (
                f"DC-gain для order={order} не равен 1: {dc_gain}"
            )


# ---------------------------------------------------------------------------
# Тесты валидации параметров
# ---------------------------------------------------------------------------


class TestButterworthValidation:
    def test_valid_parameters(self) -> None:
        errors = validate_parameters("ButterworthLPF", {"order": 2, "cutoff_freq": 10.0, "y0": 0.0})
        assert errors == []

    def test_order_zero(self) -> None:
        errors = validate_parameters("ButterworthLPF", {"order": 0, "cutoff_freq": 10.0})
        assert any("order" in e for e in errors)

    def test_order_fractional(self) -> None:
        errors = validate_parameters("ButterworthLPF", {"order": 2.5, "cutoff_freq": 10.0})
        assert any("order" in e for e in errors)

    def test_order_too_large(self) -> None:
        errors = validate_parameters("ButterworthLPF", {"order": 11, "cutoff_freq": 10.0})
        assert any("order" in e for e in errors)

    def test_cutoff_zero(self) -> None:
        errors = validate_parameters("ButterworthLPF", {"order": 2, "cutoff_freq": 0.0})
        assert any("cutoff_freq" in e for e in errors)

    def test_cutoff_negative(self) -> None:
        errors = validate_parameters("ButterworthLPF", {"order": 2, "cutoff_freq": -5.0})
        assert any("cutoff_freq" in e for e in errors)


# ---------------------------------------------------------------------------
# Тест step-response через полную симуляцию
# ---------------------------------------------------------------------------


class TestButterworthStepResponse:
    """Моделирование StepInput → ButterworthLPF(order=2, wc=10) → Scope."""

    def test_step_response_reaches_unity(self) -> None:
        """Выход ФНЧ Баттерворта на единичный скачок должен стремиться к 1."""
        request = SimulationRequest(
            diagram=Diagram.model_validate(butterworth_lpf_step_diagram()),
            t_start=0.0,
            t_end=2.0,
            dt=0.001,
            solver="rk4",
        )
        result = simulate_request(request)

        y = np.array(result.outputs["y"])
        # В установившемся режиме выход должен быть ≈ 1.0 (DC gain = 1)
        assert y[-1] == pytest.approx(1.0, abs=0.01)

    def test_step_response_starts_at_zero(self) -> None:
        """Начальное значение выхода = 0 (нет прямого прохождения)."""
        request = SimulationRequest(
            diagram=Diagram.model_validate(butterworth_lpf_step_diagram()),
            t_start=0.0,
            t_end=0.5,
            dt=0.001,
            solver="rk4",
        )
        result = simulate_request(request)

        y = np.array(result.outputs["y"])
        assert y[0] == pytest.approx(0.0, abs=1e-6)

    def test_solve_ivp_matches_rk4(self) -> None:
        """Результаты solve_ivp и rk4 должны совпадать с хорошей точностью."""
        diagram = Diagram.model_validate(butterworth_lpf_step_diagram())

        rk4_result = simulate_request(SimulationRequest(
            diagram=diagram, t_start=0.0, t_end=1.0, dt=0.001, solver="rk4",
        ))
        ivp_result = simulate_request(SimulationRequest(
            diagram=diagram, t_start=0.0, t_end=1.0, dt=0.001, solver="solve_ivp",
        ))

        y_rk4 = np.array(rk4_result.outputs["y"])
        y_ivp = np.array(ivp_result.outputs["y"])

        # Допускаем небольшое расхождение из-за разных методов
        max_diff = np.max(np.abs(y_rk4 - y_ivp))
        assert max_diff < 0.01, f"Макс. расхождение rk4 vs solve_ivp: {max_diff}"

    def test_higher_order_filter(self) -> None:
        """Фильтр 4-го порядка: проверяем что моделирование работает."""
        from app.tests.helpers import block, connection

        diagram_data = {
            "blocks": [
                block("step1", "StepInput", parameters={"amplitude": 1.0, "t0": 0.0},
                      input_ports=[], output_ports=["out"]),
                block("bw1", "ButterworthLPF",
                      parameters={"order": 4, "cutoff_freq": 5.0, "y0": 0.0},
                      input_ports=["in"], output_ports=["out"]),
                block("scope1", "Scope", parameters={"label": "y"},
                      input_ports=["in"], output_ports=[]),
            ],
            "connections": [
                connection("step1", "out", "bw1", "in"),
                connection("bw1", "out", "scope1", "in"),
            ],
        }
        request = SimulationRequest(
            diagram=Diagram.model_validate(diagram_data),
            t_start=0.0,
            t_end=3.0,
            dt=0.001,
            solver="rk4",
        )
        result = simulate_request(request)
        y = np.array(result.outputs["y"])

        # DC gain = 1
        assert y[-1] == pytest.approx(1.0, abs=0.02)
        assert y[0] == pytest.approx(0.0, abs=1e-6)

    def test_nonzero_initial_output_is_applied(self) -> None:
        diagram_data = butterworth_lpf_step_diagram()
        filter_block = next(block for block in diagram_data["blocks"] if block["id"] == "bw1")
        filter_block["parameters"]["y0"] = 1.5
        result = simulate_request(
            SimulationRequest(
                diagram=Diagram.model_validate(diagram_data),
                t_end=0.1,
                dt=0.001,
                solver="solve_ivp",
            )
        )

        assert result.outputs["y"][0] == pytest.approx(1.5, abs=1e-10)

    def test_analytic_reference_uses_full_step_input_vector(self) -> None:
        time = np.linspace(0.0, 1.0, 101)
        response = butterworth_lpf_step_response(
            time,
            order=2,
            cutoff_freq=10.0,
        )

        assert response.shape == time.shape
        assert response[-1] == pytest.approx(1.0, abs=0.01)

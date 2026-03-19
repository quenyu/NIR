from __future__ import annotations

import pytest

from app.simulation.blocks import (
    first_order_lag_derivative,
    gain_output,
    integrator_derivative,
    second_order_oscillator_derivative,
    step_input,
    sum_output,
)


def test_gain_output() -> None:
    assert gain_output(3.0, -2.0) == pytest.approx(-6.0)


def test_sum_output() -> None:
    assert sum_output([10.0, 4.0, 1.5], ["+", "-", "+"]) == pytest.approx(7.5)


def test_step_input_behavior() -> None:
    assert step_input(t=0.9, amplitude=2.5, t0=1.0) == pytest.approx(0.0)
    assert step_input(t=1.0, amplitude=2.5, t0=1.0) == pytest.approx(2.5)


def test_integrator_derivative() -> None:
    assert integrator_derivative(k=0.5, x=4.0) == pytest.approx(2.0)


def test_first_order_lag_derivative() -> None:
    derivative = first_order_lag_derivative(k=2.0, t_const=0.5, x=1.0, y=0.2)
    assert derivative == pytest.approx(3.6)


def test_second_order_oscillator_derivative() -> None:
    dy, ddy = second_order_oscillator_derivative(
        k=1.5,
        wn=3.0,
        zeta=0.2,
        x=1.0,
        y=0.1,
        y_dot=-0.2,
    )
    assert dy == pytest.approx(-0.2)
    assert ddy == pytest.approx(12.84)

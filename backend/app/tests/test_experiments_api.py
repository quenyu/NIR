from __future__ import annotations

from fastapi.testclient import TestClient


def test_experiments_catalog_endpoint_returns_available_scenarios(client: TestClient) -> None:
    response = client.get("/experiments/catalog")
    payload = response.json()

    assert response.status_code == 200
    assert payload["solvers"] == ["rk4", "solve_ivp"]
    assert [scenario["slug"] for scenario in payload["scenarios"]] == [
        "integrator",
        "first_order_lag",
        "second_order_oscillator",
        "butterworth_lpf",
    ]
    assert all(scenario["default_benchmark_repetitions"] == 10 for scenario in payload["scenarios"])
    assert all(scenario["default_benchmark_warmup"] == 2 for scenario in payload["scenarios"])


def test_experiments_run_endpoint_returns_interactive_payload(client: TestClient) -> None:
    response = client.post(
        "/experiments/run",
        json={
            "scenario": "first_order_lag",
            "solvers": ["rk4", "solve_ivp"],
            "dt": 0.02,
            "t_end": 2.0,
            "include_analytic": True,
            "run_accuracy": True,
            "run_solver_comparison": True,
            "run_dt_sweep": True,
            "dt_values": [0.1, 0.02],
            "run_benchmark": True,
            "benchmark_repetitions": 5,
            "benchmark_warmup": 1,
        },
    )
    payload = response.json()

    assert response.status_code == 200
    assert payload["scenario"]["slug"] == "first_order_lag"
    assert payload["timeseries"]["time"]
    assert payload["timeseries"]["analytic"]
    assert payload["timeseries"]["rk4"]
    assert payload["timeseries"]["solve_ivp"]
    assert len(payload["accuracy_rows"]) == 2
    assert len(payload["solver_comparison_rows"]) == 1
    assert len(payload["dt_sweep_rows"]) == 4
    assert len(payload["benchmark_summary_rows"]) == 2
    assert len(payload["benchmark_samples"]) == 10
    assert payload["interpretation_notes"]


def test_experiments_run_endpoint_warns_when_solver_comparison_is_unavailable(client: TestClient) -> None:
    response = client.post(
        "/experiments/run",
        json={
            "scenario": "integrator",
            "solvers": ["rk4"],
            "run_solver_comparison": True,
        },
    )
    payload = response.json()

    assert response.status_code == 200
    assert payload["solver_comparison_rows"] == []
    assert payload["warnings"]


def test_parametric_and_monte_carlo_experiment_returns_robust_metrics(
    client: TestClient,
) -> None:
    response = client.post(
        "/experiments/run",
        json={
            "scenario": "first_order_lag",
            "solvers": ["rk4"],
            "dt": 0.02,
            "t_end": 2.0,
            "run_accuracy": False,
            "run_solver_comparison": False,
            "run_parameter_sweep": True,
            "parameter_values": [0.3, 0.5, 0.8],
            "run_monte_carlo": True,
            "monte_carlo_samples": 12,
            "uncertainty_percent": 25.0,
            "random_seed": 7,
        },
    )
    payload = response.json()

    assert response.status_code == 200
    assert len(payload["parameter_sweep_rows"]) == 3
    assert [row["parameter_value"] for row in payload["parameter_sweep_rows"]] == [
        0.3,
        0.5,
        0.8,
    ]
    assert len(payload["monte_carlo_rows"]) == 12
    assert payload["robust_summary"]["parameter_block_id"] == "lag1"
    assert payload["robust_summary"]["parameter_name"] == "T"
    assert payload["robust_summary"]["stable_samples"] == 12
    assert payload["robust_summary"]["robust_stability_percent"] == 100.0


def test_butterworth_experiment_builds_analytic_reference(client: TestClient) -> None:
    response = client.post(
        "/experiments/run",
        json={
            "scenario": "butterworth_lpf",
            "solvers": ["rk4"],
            "run_solver_comparison": False,
        },
    )
    payload = response.json()

    assert response.status_code == 200
    assert len(payload["timeseries"]["analytic"]) == len(payload["timeseries"]["time"])
    assert payload["accuracy_rows"][0]["max_abs_error"] < 1e-6

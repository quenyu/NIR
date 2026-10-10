from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class ErrorMetrics:
    max_abs_error: float
    rmse: float
    final_value_error: float

    def as_dict(self) -> dict[str, float]:
        return {
            "max_abs_error": self.max_abs_error,
            "rmse": self.rmse,
            "final_value_error": self.final_value_error,
        }


@dataclass(frozen=True)
class TimingSummary:
    mean_ms: float
    median_ms: float
    std_ms: float
    min_ms: float
    max_ms: float

    def as_dict(self) -> dict[str, float]:
        return {
            "mean_ms": self.mean_ms,
            "median_ms": self.median_ms,
            "std_ms": self.std_ms,
            "min_ms": self.min_ms,
            "max_ms": self.max_ms,
        }


def _as_1d_array(values: np.ndarray | list[float]) -> np.ndarray:
    array = np.asarray(values, dtype=float)
    if array.ndim != 1:
        raise ValueError("Ожидался одномерный массив значений.")
    return array


def compute_error_metrics(
    actual: np.ndarray | list[float],
    reference: np.ndarray | list[float],
) -> ErrorMetrics:
    actual_array = _as_1d_array(actual)
    reference_array = _as_1d_array(reference)
    if actual_array.shape != reference_array.shape:
        raise ValueError("Массивы actual и reference должны иметь одинаковую форму.")

    error = actual_array - reference_array
    return ErrorMetrics(
        max_abs_error=float(np.max(np.abs(error))),
        rmse=float(np.sqrt(np.mean(np.square(error)))),
        final_value_error=float(error[-1]),
    )


def summarize_timings(samples_ms: np.ndarray | list[float]) -> TimingSummary:
    sample_array = _as_1d_array(samples_ms)
    if sample_array.size == 0:
        raise ValueError("Нельзя построить summary по пустому набору измерений.")

    return TimingSummary(
        mean_ms=float(np.mean(sample_array)),
        median_ms=float(np.median(sample_array)),
        std_ms=float(np.std(sample_array)),
        min_ms=float(np.min(sample_array)),
        max_ms=float(np.max(sample_array)),
    )

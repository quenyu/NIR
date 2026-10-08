from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import numpy as np
from scipy.linalg import expm, solve_discrete_are

from app.analysis.system import assemble_state_space
from app.models.learning import (
    LearnedPolicySummary,
    LearningDatasetSummary,
    LearningEvaluationRow,
    MpcTeacherSummary,
    SafeLearningRequest,
    SafeLearningResponse,
    SafeLearningSafety,
    SafeLearningTrace,
)


@dataclass(frozen=True)
class ActionDecision:
    value: float
    supervisor_active: bool = False
    certificate_active: bool = False
    candidate_saturated: bool = False
    backup_saturated: bool = False
    applied_saturated: bool = False


@dataclass(frozen=True)
class Rollout:
    time: np.ndarray
    states: np.ndarray
    actions: np.ndarray
    interventions: np.ndarray
    certificate_active: np.ndarray
    candidate_saturations: np.ndarray
    backup_saturations: np.ndarray
    applied_saturations: np.ndarray
    cost: float


@dataclass
class MpcDiagnostics:
    queries: int = 0
    iteration_total: int = 0
    max_iterations_used: int = 0
    max_projected_residual: float = 0.0
    unconverged_queries: int = 0
    active_constraint_queries: int = 0

    def record(
        self,
        iterations: int,
        residual: float,
        converged: bool,
        active_constraint: bool,
    ) -> None:
        self.queries += 1
        self.iteration_total += iterations
        self.max_iterations_used = max(self.max_iterations_used, iterations)
        self.max_projected_residual = max(self.max_projected_residual, residual)
        self.unconverged_queries += int(not converged)
        self.active_constraint_queries += int(active_constraint)


@dataclass
class MpcController:
    hessian: np.ndarray
    linear_map: np.ndarray
    sequence_gain: np.ndarray
    local_gain: np.ndarray
    horizon_steps: int
    dt: float
    input_limit: float | None
    max_iterations: int
    tolerance: float
    diagonal: np.ndarray
    diagnostics: MpcDiagnostics

    def solve(self, state: np.ndarray) -> ActionDecision:
        linear = self.linear_map @ state
        unconstrained = -(self.sequence_gain @ state)

        if self.input_limit is None:
            action = float(unconstrained[0])
            self.diagnostics.record(0, 0.0, True, False)
            return ActionDecision(action)

        limit = self.input_limit
        sequence = np.clip(unconstrained, -limit, limit)
        residual = float("inf")
        converged = False
        iterations = 0

        for iterations in range(1, self.max_iterations + 1):
            gradient = self.hessian @ sequence + linear
            for coordinate in range(sequence.size):
                updated_value = float(
                    np.clip(
                        sequence[coordinate] - gradient[coordinate] / self.diagonal[coordinate],
                        -limit,
                        limit,
                    )
                )
                delta = updated_value - sequence[coordinate]
                if delta != 0.0:
                    sequence[coordinate] = updated_value
                    gradient += self.hessian[:, coordinate] * delta
            projected = np.clip(
                sequence - gradient / self.diagonal,
                -limit,
                limit,
            )
            residual = float(np.max(np.abs(sequence - projected)))
            if residual <= self.tolerance:
                converged = True
                break

        action = float(sequence[0])
        active_tolerance = max(1e-8, limit * 1e-6)
        active_constraint = abs(action) >= limit - active_tolerance
        self.diagnostics.record(iterations, residual, converged, active_constraint)
        return ActionDecision(
            action,
            candidate_saturated=active_constraint,
            applied_saturated=active_constraint,
        )


@dataclass(frozen=True)
class NonlinearPolicyModel:
    scales: np.ndarray
    base_gain: np.ndarray
    weights: np.ndarray

    @property
    def feature_count(self) -> int:
        return int(self.weights.shape[0])

    def design(self, states: np.ndarray) -> np.ndarray:
        samples = np.asarray(states, dtype=float)
        if samples.ndim == 1:
            samples = samples.reshape(1, -1)
        normalized = samples / self.scales
        norm = np.linalg.norm(normalized, axis=1, keepdims=True)
        bounded_norm = norm / (1.0 + norm)
        return np.hstack(
            (
                np.tanh(normalized) - normalized,
                normalized * bounded_norm,
                normalized * (norm**2 / (1.0 + norm**2)),
            )
        )

    def actions(self, states: np.ndarray, input_limit: float | None) -> np.ndarray:
        samples = np.asarray(states, dtype=float)
        if samples.ndim == 1:
            samples = samples.reshape(1, -1)
        values = -samples @ self.base_gain.T + self.design(samples) @ self.weights
        if input_limit is not None:
            values = np.clip(values, -input_limit, input_limit)
        return values[:, 0]

    def local_gain(self) -> np.ndarray:
        return self.base_gain.copy()


Policy = Callable[[np.ndarray], ActionDecision]


def _controllability_rank(a: np.ndarray, b: np.ndarray) -> int:
    n = a.shape[0]
    columns = [b]
    current = b
    for _ in range(1, n):
        current = a @ current
        columns.append(current)
    return int(np.linalg.matrix_rank(np.hstack(columns)))


def _discrete_lqr(
    a: np.ndarray,
    b: np.ndarray,
    q: np.ndarray,
    r: float,
) -> tuple[np.ndarray, np.ndarray]:
    try:
        p = solve_discrete_are(a, b, q, np.asarray([[r]], dtype=float))
    except Exception as exc:  # scipy exposes several solver-specific exception types
        raise ValueError(
            "Для выбранного канала не удалось решить дискретное уравнение Риккати."
        ) from exc
    control_hessian = np.asarray([[r]], dtype=float) + b.T @ p @ b
    try:
        k = np.linalg.solve(control_hessian, b.T @ p @ a)
    except np.linalg.LinAlgError as exc:
        raise ValueError("Не удалось вычислить дискретный закон LQR.") from exc
    if not np.all(np.isfinite(p)) or not np.all(np.isfinite(k)):
        raise ValueError("Решение LQR содержит неконечные значения.")
    return np.asarray(k, dtype=float), np.asarray(p, dtype=float)


def _zero_order_hold(a: np.ndarray, b: np.ndarray, dt: float) -> tuple[np.ndarray, np.ndarray]:
    state_dimension = a.shape[0]
    augmented = np.zeros((state_dimension + 1, state_dimension + 1), dtype=float)
    augmented[:state_dimension, :state_dimension] = a
    augmented[:state_dimension, state_dimension:] = b
    discrete = expm(augmented * dt)
    return discrete[:state_dimension, :state_dimension], discrete[:state_dimension, state_dimension:]


def _build_mpc_controller(
    a_discrete: np.ndarray,
    b_discrete: np.ndarray,
    q: np.ndarray,
    r: float,
    request: SafeLearningRequest,
) -> tuple[MpcController, np.ndarray]:
    try:
        terminal_p = solve_discrete_are(
            a_discrete,
            b_discrete,
            q,
            np.asarray([[r]], dtype=float),
        )
    except Exception as exc:
        raise ValueError("Не удалось вычислить терминальную стоимость MPC.") from exc

    n = a_discrete.shape[0]
    horizon = request.mpc_horizon_steps
    powers = [np.eye(n, dtype=float)]
    for _ in range(horizon):
        powers.append(a_discrete @ powers[-1])

    prediction = np.zeros((horizon * n, n), dtype=float)
    control = np.zeros((horizon * n, horizon), dtype=float)
    for step in range(1, horizon + 1):
        row = slice((step - 1) * n, step * n)
        prediction[row, :] = powers[step]
        for control_step in range(step):
            control[row, control_step] = (
                powers[step - 1 - control_step] @ b_discrete
            )[:, 0]

    state_weight = np.zeros((horizon * n, horizon * n), dtype=float)
    for step in range(horizon - 1):
        row = slice(step * n, (step + 1) * n)
        state_weight[row, row] = q
    state_weight[(horizon - 1) * n : horizon * n, (horizon - 1) * n : horizon * n] = (
        terminal_p
    )

    hessian = control.T @ state_weight @ control + r * np.eye(horizon, dtype=float)
    hessian = 0.5 * (hessian + hessian.T)
    linear_map = control.T @ state_weight @ prediction
    try:
        sequence_gain = np.linalg.solve(hessian, linear_map)
    except np.linalg.LinAlgError:
        sequence_gain = np.linalg.pinv(hessian) @ linear_map
    diagonal = np.diag(hessian).copy()
    if not np.all(np.isfinite(diagonal)) or np.any(diagonal <= 0.0):
        raise ValueError("Квадратичная задача MPC не является положительно определённой.")

    controller = MpcController(
        hessian=hessian,
        linear_map=linear_map,
        sequence_gain=sequence_gain,
        local_gain=sequence_gain[[0], :],
        horizon_steps=horizon,
        dt=request.dt,
        input_limit=request.input_limit,
        max_iterations=request.mpc_iterations,
        tolerance=request.mpc_tolerance,
        diagonal=diagonal,
        diagnostics=MpcDiagnostics(),
    )
    return controller, np.asarray(terminal_p, dtype=float)


def _time_grid(horizon: float, dt: float) -> np.ndarray:
    steps = int(round(horizon / dt))
    time = dt * np.arange(steps + 1, dtype=float)
    time[-1] = horizon
    return time


def _closed_loop_poles(a: np.ndarray, b: np.ndarray, gain: np.ndarray) -> np.ndarray:
    return np.linalg.eigvals(a - b @ gain)


def _pole_records(poles: np.ndarray) -> list[dict[str, float]]:
    return [
        {"real": float(np.real(value)), "imag": float(np.imag(value))}
        for value in poles
    ]


def _is_schur(poles: np.ndarray, tolerance: float = 1e-9) -> bool:
    return bool(poles.size > 0 and np.all(np.abs(poles) < 1.0 - tolerance))


def _saturate(action: float, input_limit: float | None) -> tuple[float, bool]:
    if input_limit is None:
        return action, False
    saturated = abs(action) > input_limit + 1e-12
    return float(np.clip(action, -input_limit, input_limit)), saturated


def _rollout(
    a_discrete: np.ndarray,
    b_discrete: np.ndarray,
    q: np.ndarray,
    r: float,
    x0: np.ndarray,
    time: np.ndarray,
    policy: Policy,
) -> Rollout:
    states = np.zeros((time.size, x0.size), dtype=float)
    actions = np.zeros(time.size, dtype=float)
    interventions = np.zeros(time.size, dtype=int)
    certificate_active = np.zeros(time.size, dtype=int)
    candidate_saturations = np.zeros(time.size, dtype=int)
    backup_saturations = np.zeros(time.size, dtype=int)
    applied_saturations = np.zeros(time.size, dtype=int)
    states[0] = x0

    for index in range(time.size):
        decision = policy(states[index])
        actions[index] = decision.value
        interventions[index] = int(decision.supervisor_active)
        certificate_active[index] = int(decision.certificate_active)
        candidate_saturations[index] = int(decision.candidate_saturated)
        backup_saturations[index] = int(decision.backup_saturated)
        applied_saturations[index] = int(decision.applied_saturated)
        if index >= time.size - 1:
            continue
        states[index + 1] = (
            a_discrete @ states[index]
            + b_discrete[:, 0] * decision.value
        )
        if not np.all(np.isfinite(states[index + 1])) or np.linalg.norm(states[index + 1]) > 1e10:
            states[index + 1 :] = states[index + 1]
            break

    state_cost = np.einsum("ti,ij,tj->t", states, q, states)
    running_cost = state_cost + r * actions * actions
    cost = float(np.sum(running_cost[:-1] * np.diff(time)))
    return Rollout(
        time=time,
        states=states,
        actions=actions,
        interventions=interventions,
        certificate_active=certificate_active,
        candidate_saturations=candidate_saturations,
        backup_saturations=backup_saturations,
        applied_saturations=applied_saturations,
        cost=cost,
    )


def _linear_policy(gain: np.ndarray, input_limit: float | None) -> Policy:
    def policy(state: np.ndarray) -> ActionDecision:
        raw_action = -float((gain @ state).item())
        action, saturated = _saturate(raw_action, input_limit)
        return ActionDecision(
            action,
            candidate_saturated=saturated,
            applied_saturated=saturated,
        )

    return policy


def _nonlinear_policy(model: NonlinearPolicyModel, input_limit: float | None) -> Policy:
    def policy(state: np.ndarray) -> ActionDecision:
        raw_action = float(
            (-(state.reshape(1, -1) @ model.base_gain.T) + model.design(state) @ model.weights).item()
        )
        action, saturated = _saturate(raw_action, input_limit)
        return ActionDecision(
            action,
            candidate_saturated=saturated,
            applied_saturated=saturated,
        )

    return policy


def _certified_region(
    a_discrete: np.ndarray,
    b_discrete: np.ndarray,
    gain: np.ndarray,
    lyapunov_matrix: np.ndarray,
    input_limit: float | None,
    sample_time: float,
) -> tuple[float | None, float | None, float]:
    closed_loop = a_discrete - b_discrete @ gain
    decrease_matrix = lyapunov_matrix - closed_loop.T @ lyapunov_matrix @ closed_loop
    decrease_matrix = 0.5 * (decrease_matrix + decrease_matrix.T)
    guaranteed_decay = float(
        np.min(np.linalg.eigvalsh(decrease_matrix)) / sample_time
    )
    if not np.isfinite(guaranteed_decay) or guaranteed_decay <= 1e-10:
        raise ValueError("Резервный LQR не дал положительно определённую оценку убывания V.")

    if input_limit is None:
        return None, None, guaranteed_decay

    try:
        direction = np.linalg.solve(lyapunov_matrix, gain.T)
    except np.linalg.LinAlgError as exc:
        raise ValueError("Матрица функции Ляпунова оказалась вырожденной.") from exc
    denominator = float((gain @ direction).item())
    if not np.isfinite(denominator) or denominator <= 1e-14:
        raise ValueError("Не удалось вычислить область, совместимую с ограничением управления.")

    rho = float(input_limit * input_limit / denominator)
    largest_eigenvalue = float(np.max(np.linalg.eigvalsh(lyapunov_matrix)))
    inner_radius = float(np.sqrt(rho / largest_eigenvalue))
    return rho, inner_radius, guaranteed_decay


def _supervised_policy(
    a_discrete: np.ndarray,
    b_discrete: np.ndarray,
    candidate_policy: Policy,
    basis_gain: np.ndarray,
    lyapunov_matrix: np.ndarray,
    decay: float,
    sample_time: float,
    input_limit: float | None,
    certified_rho: float | None,
) -> Policy:
    def policy(state: np.ndarray) -> ActionDecision:
        lyapunov_value = float(state.T @ lyapunov_matrix @ state)
        certificate_active = certified_rho is None or lyapunov_value <= certified_rho * (1.0 + 1e-10)

        candidate = candidate_policy(state)
        candidate_next = (
            a_discrete @ state + b_discrete[:, 0] * candidate.value
        )
        lyapunov_difference = float(
            candidate_next.T @ lyapunov_matrix @ candidate_next - lyapunov_value
        )
        threshold = -decay * sample_time * float(state @ state)
        if lyapunov_difference <= threshold + 1e-10:
            return ActionDecision(
                candidate.value,
                certificate_active=certificate_active,
                candidate_saturated=candidate.applied_saturated,
                applied_saturated=candidate.applied_saturated,
            )

        basis_raw = -float((basis_gain @ state).item())
        basis_action, basis_saturated = _saturate(basis_raw, input_limit)
        return ActionDecision(
            basis_action,
            supervisor_active=True,
            certificate_active=certificate_active,
            candidate_saturated=candidate.applied_saturated,
            backup_saturated=basis_saturated,
            applied_saturated=basis_saturated,
        )

    return policy


def _collect_teacher_trajectories(
    a_discrete: np.ndarray,
    b_discrete: np.ndarray,
    q: np.ndarray,
    request: SafeLearningRequest,
    rng: np.random.Generator,
    time: np.ndarray,
    teacher: Policy,
    count: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    noisy_states: list[np.ndarray] = []
    clean_states: list[np.ndarray] = []
    targets: list[np.ndarray] = []

    for _ in range(count):
        x0 = rng.uniform(
            -request.initial_state_scale,
            request.initial_state_scale,
            size=a_discrete.shape[0],
        )
        rollout = _rollout(
            a_discrete,
            b_discrete,
            q,
            request.control_weight,
            x0,
            time,
            teacher,
        )
        noise = rng.normal(0.0, request.state_noise_std, size=rollout.states.shape)
        noisy_states.append(np.vstack((rollout.states, rollout.states + noise)))
        clean_states.append(np.vstack((rollout.states, rollout.states)))
        target = rollout.actions.reshape(-1, 1)
        targets.append(np.vstack((target, target)))

    return np.vstack(noisy_states), np.vstack(clean_states), np.vstack(targets)


def _policy_actions(policy: Policy, states: np.ndarray) -> np.ndarray:
    return np.asarray([policy(state).value for state in states], dtype=float)


def _collect_on_policy_trajectories(
    a_discrete: np.ndarray,
    b_discrete: np.ndarray,
    q: np.ndarray,
    request: SafeLearningRequest,
    rng: np.random.Generator,
    time: np.ndarray,
    behavior: Policy,
    teacher: Policy,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    noisy_states: list[np.ndarray] = []
    clean_states: list[np.ndarray] = []
    targets: list[np.ndarray] = []
    behavior_actions: list[np.ndarray] = []

    for _ in range(request.on_policy_trajectories):
        x0 = rng.uniform(
            -request.initial_state_scale,
            request.initial_state_scale,
            size=a_discrete.shape[0],
        )
        rollout = _rollout(
            a_discrete,
            b_discrete,
            q,
            request.control_weight,
            x0,
            time,
            behavior,
        )
        target_actions = _policy_actions(teacher, rollout.states)
        noise = rng.normal(0.0, request.state_noise_std, size=rollout.states.shape)
        noisy_states.append(np.vstack((rollout.states, rollout.states + noise)))
        clean_states.append(np.vstack((rollout.states, rollout.states)))
        target = target_actions.reshape(-1, 1)
        behavior_values = rollout.actions.reshape(-1, 1)
        targets.append(np.vstack((target, target)))
        behavior_actions.append(np.vstack((behavior_values, behavior_values)))

    return (
        np.vstack(noisy_states),
        np.vstack(clean_states),
        np.vstack(targets),
        np.vstack(behavior_actions),
    )


def _fit_nonlinear_policy(
    observed_states: np.ndarray,
    targets: np.ndarray,
    ridge: float,
    initial_state_scale: float,
    base_gain: np.ndarray,
) -> NonlinearPolicyModel:
    minimum_scale = max(0.05 * initial_state_scale, 1e-6)
    scales = np.maximum(np.std(observed_states, axis=0), minimum_scale)
    temporary = NonlinearPolicyModel(
        scales=scales,
        base_gain=base_gain,
        weights=np.zeros((3 * observed_states.shape[1], 1), dtype=float),
    )
    design = temporary.design(observed_states)
    base_actions = -observed_states @ base_gain.T
    residual_targets = targets - base_actions
    regularizer = ridge * np.eye(design.shape[1], dtype=float)
    try:
        weights = np.linalg.solve(
            design.T @ design + regularizer,
            design.T @ residual_targets,
        )
    except np.linalg.LinAlgError:
        weights = (
            np.linalg.pinv(design.T @ design + regularizer)
            @ design.T
            @ residual_targets
        )
    return NonlinearPolicyModel(scales=scales, base_gain=base_gain, weights=weights)


def _rmse(values: np.ndarray, targets: np.ndarray) -> float:
    return float(np.sqrt(np.mean((values.reshape(-1) - targets.reshape(-1)) ** 2)))


def _evaluation_row(
    name: str,
    rollouts: list[Rollout],
    initial_state_scale: float,
) -> LearningEvaluationRow:
    costs = np.asarray([item.cost for item in rollouts], dtype=float)
    worst_norm = max(float(np.max(np.linalg.norm(item.states, axis=1))) for item in rollouts)
    stabilized = 0
    for item in rollouts:
        initial_norm = float(np.linalg.norm(item.states[0]))
        final_norm = float(np.linalg.norm(item.states[-1]))
        target = max(0.10 * initial_norm, 0.03 * initial_state_scale)
        finite = np.all(np.isfinite(item.states))
        bounded = float(np.max(np.linalg.norm(item.states, axis=1))) <= max(20.0 * initial_norm, 1.0)
        stabilized += int(finite and bounded and final_norm <= target)
    # There are N control intervals for N + 1 sampled states.  The final
    # policy value is retained for plotting/label generation, but it is not
    # applied to the plant and must not inflate actuator statistics.
    saturation_count = int(
        sum(np.sum(item.applied_saturations[:-1]) for item in rollouts)
    )
    decision_count = int(sum(max(item.actions.size - 1, 0) for item in rollouts))
    return LearningEvaluationRow(
        policy=name,
        mean_cost=float(np.mean(costs)),
        median_cost=float(np.median(costs)),
        stabilization_percent=100.0 * stabilized / len(rollouts),
        worst_state_norm=worst_norm,
        saturation_percent=100.0 * saturation_count / max(decision_count, 1),
    )


def run_safe_learning(request: SafeLearningRequest) -> SafeLearningResponse:
    system = assemble_state_space(request.diagram)
    a = np.asarray(system["matrices"]["A"], dtype=float)
    b_all = np.asarray(system["matrices"]["B"], dtype=float)
    c_all = np.asarray(system["matrices"]["C"], dtype=float)
    d_all = np.asarray(system["matrices"]["D"], dtype=float)
    input_ids = list(system["input_blocks"])
    output_labels = list(system["output_labels"])
    n = int(system["state_dimension"])

    if n == 0:
        raise ValueError("Обучение регулятора требует динамическую модель хотя бы первого порядка.")
    if n > 12:
        raise ValueError("Для интерактивного обучения поддерживаются модели порядка не выше 12.")
    if not input_ids:
        raise ValueError("В модели нет внешнего входа, который можно использовать как канал управления.")
    if not output_labels:
        raise ValueError("Добавьте Scope: нужен наблюдаемый выход для сравнения траекторий.")

    input_id = request.input_block_id or input_ids[0]
    if input_id not in input_ids:
        raise ValueError(f"Вход '{input_id}' не найден в общей модели.")
    output_label = request.output_label or output_labels[0]
    if output_label not in output_labels:
        raise ValueError(f"Выход '{output_label}' не найден в общей модели.")

    input_index = input_ids.index(input_id)
    output_index = output_labels.index(output_label)
    b = b_all[:, [input_index]]
    c = c_all[[output_index], :]
    d = float(d_all[output_index, input_index])
    controllability_rank = _controllability_rank(a, b)
    if controllability_rank != n:
        raise ValueError(
            f"Выбранный канал управляет {controllability_rank} состояниями из {n}; "
            "для MPC, LQR и Lyapunov-supervisor требуется полная управляемость."
        )

    q = np.eye(n, dtype=float)
    q_discrete = q * request.dt
    control_weight_discrete = request.control_weight * request.dt
    a_discrete, b_discrete = _zero_order_hold(a, b, request.dt)
    basis_weight = control_weight_discrete * request.basis_control_ratio
    basis_gain, basis_p = _discrete_lqr(
        a_discrete,
        b_discrete,
        q_discrete,
        basis_weight,
    )
    certified_rho, certified_inner_radius, backup_decay = _certified_region(
        a_discrete,
        b_discrete,
        basis_gain,
        basis_p,
        request.input_limit,
        request.dt,
    )

    mpc_controller, terminal_p = _build_mpc_controller(
        a_discrete,
        b_discrete,
        q_discrete,
        control_weight_discrete,
        request,
    )
    teacher_policy: Policy = mpc_controller.solve

    time = _time_grid(request.horizon, request.dt)
    rng = np.random.default_rng(request.seed)
    initial_features, initial_clean_states, initial_targets = _collect_teacher_trajectories(
        a_discrete,
        b_discrete,
        q,
        request,
        rng,
        time,
        teacher_policy,
        request.training_trajectories,
    )

    feature_chunks = [initial_features]
    clean_chunks = [initial_clean_states]
    target_chunks = [initial_targets]
    learner_model = _fit_nonlinear_policy(
        initial_features,
        initial_targets,
        request.ridge,
        request.initial_state_scale,
        mpc_controller.local_gain,
    )

    on_policy_round_samples: list[int] = []
    on_policy_clean_chunks: list[np.ndarray] = []
    on_policy_target_chunks: list[np.ndarray] = []
    on_policy_pre_squared_error = 0.0
    on_policy_pre_count = 0

    for _ in range(request.on_policy_rounds):
        behavior_policy = _nonlinear_policy(learner_model, request.input_limit)
        noisy_states, clean_states, targets, behavior_actions = _collect_on_policy_trajectories(
            a_discrete,
            b_discrete,
            q,
            request,
            rng,
            time,
            behavior_policy,
            teacher_policy,
        )
        on_policy_round_samples.append(int(clean_states.shape[0]))
        on_policy_pre_squared_error += float(np.sum((behavior_actions - targets) ** 2))
        on_policy_pre_count += int(targets.size)
        on_policy_clean_chunks.append(clean_states)
        on_policy_target_chunks.append(targets)
        feature_chunks.append(noisy_states)
        clean_chunks.append(clean_states)
        target_chunks.append(targets)
        learner_model = _fit_nonlinear_policy(
            np.vstack(feature_chunks),
            np.vstack(target_chunks),
            request.ridge,
            request.initial_state_scale,
            mpc_controller.local_gain,
        )

    all_clean_states = np.vstack(clean_chunks)
    all_targets = np.vstack(target_chunks)
    learner_policy = _nonlinear_policy(learner_model, request.input_limit)
    train_actions = learner_model.actions(all_clean_states, request.input_limit)
    train_rmse = _rmse(train_actions, all_targets)

    test_states = rng.uniform(
        -request.initial_state_scale,
        request.initial_state_scale,
        size=(max(200, request.validation_trajectories * 8), n),
    )
    test_targets = _policy_actions(teacher_policy, test_states)
    test_actions = learner_model.actions(test_states, request.input_limit)
    test_rmse = _rmse(test_actions, test_targets)

    if on_policy_clean_chunks:
        on_policy_clean = np.vstack(on_policy_clean_chunks)
        on_policy_targets = np.vstack(on_policy_target_chunks)
        on_policy_rmse_before = float(
            np.sqrt(on_policy_pre_squared_error / max(on_policy_pre_count, 1))
        )
        on_policy_rmse_after = _rmse(
            learner_model.actions(on_policy_clean, request.input_limit),
            on_policy_targets,
        )
    else:
        on_policy_rmse_before = None
        on_policy_rmse_after = None

    basis_policy = _linear_policy(basis_gain, request.input_limit)
    supervised_policy = _supervised_policy(
        a_discrete,
        b_discrete,
        learner_policy,
        basis_gain,
        basis_p,
        request.safety_decay,
        request.dt,
        request.input_limit,
        certified_rho,
    )

    validation_initial_states = rng.uniform(
        -request.initial_state_scale,
        request.initial_state_scale,
        size=(request.validation_trajectories, n),
    )
    rollout_groups: dict[str, list[Rollout]] = {
        "basis": [],
        "teacher": [],
        "learner": [],
        "supervised": [],
    }
    policies: dict[str, Policy] = {
        "basis": basis_policy,
        "teacher": teacher_policy,
        "learner": learner_policy,
        "supervised": supervised_policy,
    }
    for x0 in validation_initial_states:
        for name, policy in policies.items():
            rollout_groups[name].append(
                _rollout(
                    a_discrete,
                    b_discrete,
                    q,
                    request.control_weight,
                    x0,
                    time,
                    policy,
                )
            )

    evaluation = [
        _evaluation_row("Резервный LQR", rollout_groups["basis"], request.initial_state_scale),
        _evaluation_row("Ограниченный MPC", rollout_groups["teacher"], request.initial_state_scale),
        _evaluation_row("Нелинейный ученик", rollout_groups["learner"], request.initial_state_scale),
        _evaluation_row(
            "Ученик + supervisor",
            rollout_groups["supervised"],
            request.initial_state_scale,
        ),
    ]

    representative = {name: values[0] for name, values in rollout_groups.items()}

    def output_series(rollout: Rollout) -> list[float]:
        values = rollout.states @ c.T + d * rollout.actions.reshape(-1, 1)
        return [float(value) for value in values[:, 0]]

    supervised_rollouts = rollout_groups["supervised"]
    intervention_count = int(
        sum(np.sum(item.interventions[:-1]) for item in supervised_rollouts)
    )
    decision_count = int(
        sum(max(item.interventions.size - 1, 0) for item in supervised_rollouts)
    )
    certified_decisions = int(
        sum(np.sum(item.certificate_active[:-1]) for item in supervised_rollouts)
    )
    heuristic_decisions = decision_count - certified_decisions
    candidate_saturations = int(
        sum(np.sum(item.candidate_saturations[:-1]) for item in supervised_rollouts)
    )
    backup_saturations = int(
        sum(np.sum(item.backup_saturations[:-1]) for item in supervised_rollouts)
    )
    certified_backup_saturations = int(
        sum(
            np.sum(item.backup_saturations[:-1] * item.certificate_active[:-1])
            for item in supervised_rollouts
        )
    )
    intervention_percent = 100.0 * intervention_count / max(decision_count, 1)

    initial_lyapunov_values = np.einsum(
        "ti,ij,tj->t",
        validation_initial_states,
        basis_p,
        validation_initial_states,
    )
    if certified_rho is None:
        initial_states_inside_percent = 100.0
    else:
        initial_states_inside_percent = 100.0 * float(
            np.mean(initial_lyapunov_values <= certified_rho * (1.0 + 1e-10))
        )

    learner_gain = learner_model.local_gain()
    policy_summaries: list[LearnedPolicySummary] = []
    for name, role, kind, feature_count, gain in (
        (
            "basis",
            "стабилизирующая резервная политика",
            "linear_state_feedback",
            n,
            basis_gain,
        ),
        (
            "teacher",
            "ограниченный конечногоризонтный MPC-учитель",
            "finite_horizon_mpc",
            request.mpc_horizon_steps,
            mpc_controller.local_gain,
        ),
        (
            "learner",
            "нечётная нелинейная политика, обученная по демонстрациям и своим состояниям",
            "nonlinear_ridge_features",
            learner_model.feature_count,
            learner_gain,
        ),
    ):
        poles = _closed_loop_poles(a_discrete, b_discrete, gain)
        policy_summaries.append(
            LearnedPolicySummary(
                name=name,
                role=role,
                policy_kind=kind,
                feature_count=feature_count,
                gain=gain.tolist(),
                closed_loop_poles=_pole_records(poles),
                pole_domain="z",
                asymptotically_stable=_is_schur(poles),
            )
        )

    diagnostics = mpc_controller.diagnostics
    teacher_summary = MpcTeacherSummary(
        kind="finite_horizon_linear_mpc",
        solver="condensed_box_qp_coordinate_descent",
        horizon_steps=request.mpc_horizon_steps,
        sample_time=request.dt,
        prediction_horizon=request.mpc_horizon_steps * request.dt,
        decision_variables=request.mpc_horizon_steps,
        input_constraint=(
            "не задано"
            if request.input_limit is None
            else f"-{request.input_limit:g} <= u_k <= {request.input_limit:g}"
        ),
        state_constraints="не заданы; состояние входит только в квадратичный критерий",
        terminal_cost="x_N^T P_DARE x_N",
        iterations_limit=request.mpc_iterations,
        tolerance=request.mpc_tolerance,
        solver_queries=diagnostics.queries,
        mean_iterations=diagnostics.iteration_total / max(diagnostics.queries, 1),
        max_iterations_used=diagnostics.max_iterations_used,
        max_projected_residual=diagnostics.max_projected_residual,
        unconverged_queries=diagnostics.unconverged_queries,
        converged_percent=100.0
        * (diagnostics.queries - diagnostics.unconverged_queries)
        / max(diagnostics.queries, 1),
        active_constraint_percent=100.0
        * diagnostics.active_constraint_queries
        / max(diagnostics.queries, 1),
    )

    warnings = [
        "Регуляторы используют полный вектор состояния x; наблюдатель состояния в этом режиме не синтезируется.",
        "MPC-учитель ограничивает вход u, но не задаёт ограничений на состояния и выходы.",
        "On-policy-раунды соответствуют агрегации демонстраций в духе DAgger; это imitation learning, а не reinforcement learning.",
        "Нелинейный ученик использует фиксированную нечётную базу признаков и ridge-регрессию, а не нейронную сеть.",
        "Начальные состояния задаются в нормированных координатах, поэтому перед физическим экспериментом требуется масштабирование.",
        "Локальные полюса вычислены в z-плоскости для sampled-data линеаризации около x=0; фактические траектории учитывают ограничения управления.",
        "Функция Ляпунова подтверждает локальную устойчивость номинальной модели, но не ограничения состояния; для них требуется отдельная CBF-проверка.",
    ]
    if abs(d) > 1e-12:
        warnings.append(
            "Выбранный выход имеет прямую передачу D; она учтена на графике, но не входит в MPC/LQR-критерий."
        )
    if heuristic_decisions:
        warnings.append(
            "Вне Ωρ supervisor работает как эвристическое восстановление: насыщенный резервный LQR "
            "может не обеспечивать убывание V."
        )
    if backup_saturations:
        warnings.append(
            f"Резервное управление насыщалось {backup_saturations} раз вне сертифицированного режима."
        )
    if certified_backup_saturations:
        warnings.append(
            "Численная проверка обнаружила насыщение резервного LQR внутри Ωρ; "
            "сертифицированную область следует считать недействительной для этого расчёта."
        )
    if request.safety_decay > backup_decay:
        warnings.append(
            "Заданный α строже гарантированной скорости убывания резервного LQR; "
            "он используется только как порог допуска обученной политики."
        )
    if teacher_summary.active_constraint_percent < 0.1 and request.input_limit is not None:
        warnings.append(
            "Ограничение MPC почти не активировалось. Чтобы увидеть нелинейный режим, "
            "уменьшите umax или увеличьте масштаб начальных состояний."
        )
    if diagnostics.unconverged_queries:
        warnings.append(
            f"QP-решатель не достиг заданного допуска в {diagnostics.unconverged_queries} запросах; "
            "увеличьте лимит итераций MPC или ослабьте допуск."
        )
    if not _is_schur(_closed_loop_poles(a_discrete, b_discrete, learner_gain)):
        warnings.append(
            "Локальная линеаризация ученика неустойчива; используйте только режим с supervisor "
            "или увеличьте объём обучающей выборки."
        )

    representative_supervised = representative["supervised"]
    lyapunov_values = np.einsum(
        "ti,ij,tj->t",
        representative_supervised.states,
        basis_p,
        representative_supervised.states,
    )
    trace = SafeLearningTrace(
        time=[float(value) for value in time],
        basis_output=output_series(representative["basis"]),
        teacher_output=output_series(representative["teacher"]),
        learner_output=output_series(representative["learner"]),
        supervised_output=output_series(representative_supervised),
        basis_action=representative["basis"].actions.tolist(),
        teacher_action=representative["teacher"].actions.tolist(),
        learner_action=representative["learner"].actions.tolist(),
        supervised_action=representative_supervised.actions.tolist(),
        basis_state_norm=np.linalg.norm(representative["basis"].states, axis=1).tolist(),
        teacher_state_norm=np.linalg.norm(representative["teacher"].states, axis=1).tolist(),
        learner_state_norm=np.linalg.norm(representative["learner"].states, axis=1).tolist(),
        supervised_state_norm=np.linalg.norm(representative_supervised.states, axis=1).tolist(),
        lyapunov_value=lyapunov_values.tolist(),
        supervisor_active=representative_supervised.interventions.tolist(),
        certificate_active=representative_supervised.certificate_active.tolist(),
    )

    initial_teacher_samples = int(initial_clean_states.shape[0])
    on_policy_samples = int(sum(on_policy_round_samples))
    return SafeLearningResponse(
        success=True,
        model={
            "state_dimension": n,
            "input_block_id": input_id,
            "output_label": output_label,
            "controllability_rank": controllability_rank,
            "full_state_feedback": True,
            "A": a.tolist(),
            "B": b.tolist(),
            "C": c.tolist(),
            "D": [[d]],
            "Ad": a_discrete.tolist(),
            "Bd": b_discrete.tolist(),
            "mpc_terminal_P": terminal_p.tolist(),
        },
        dataset=LearningDatasetSummary(
            training_trajectories=request.training_trajectories,
            initial_teacher_samples=initial_teacher_samples,
            on_policy_rounds=request.on_policy_rounds,
            on_policy_trajectories_per_round=request.on_policy_trajectories,
            on_policy_round_samples=on_policy_round_samples,
            on_policy_samples=on_policy_samples,
            training_samples=int(all_clean_states.shape[0]),
            validation_trajectories=request.validation_trajectories,
            state_noise_std=request.state_noise_std,
            ridge=request.ridge,
            feature_count=learner_model.feature_count,
            train_imitation_rmse=train_rmse,
            test_imitation_rmse=test_rmse,
            on_policy_rmse_before=on_policy_rmse_before,
            on_policy_rmse_after=on_policy_rmse_after,
        ),
        teacher=teacher_summary,
        policies=policy_summaries,
        evaluation=evaluation,
        safety=SafeLearningSafety(
            certificate_kind=(
                "global_unsaturated" if certified_rho is None else "local_invariant_ellipsoid"
            ),
            certificate_domain="sampled_data",
            sample_time=request.dt,
            lyapunov_function="V(x) = x^T P_basis x",
            lyapunov_matrix=basis_p.tolist(),
            admission_condition=(
                "V(x_{k+1}) - V(x_k) <= -alpha * dt * ||x_k||^2 "
                "для приложенного u_k"
            ),
            requested_decay=request.safety_decay,
            backup_decay=backup_decay,
            input_limit=request.input_limit,
            certified_rho=certified_rho,
            certified_inner_radius=certified_inner_radius,
            validation_initial_states_inside_percent=initial_states_inside_percent,
            certified_decisions=certified_decisions,
            heuristic_decisions=heuristic_decisions,
            certified_decision_percent=100.0 * certified_decisions / max(decision_count, 1),
            interventions=intervention_count,
            decisions=decision_count,
            intervention_percent=intervention_percent,
            candidate_acceptance_percent=100.0 - intervention_percent,
            candidate_saturations=candidate_saturations,
            backup_saturations=backup_saturations,
            certified_backup_saturations=certified_backup_saturations,
        ),
        trace=trace,
        warnings=warnings,
    )

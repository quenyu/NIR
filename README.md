# Web-Oriented System for Visual Modeling of Dynamic Systems (NIR Prototype)

## Project Purpose
This repository contains a research-grade prototype for an undergraduate research project (НИР) on browser-based visual modeling of dynamic systems.

The prototype implements a complete vertical slice:

`diagram -> validation -> mathematical compilation -> simulation -> chart`

Focus areas:
- mathematical correctness
- transparent internal architecture
- validation and error reporting
- reproducible automated testing

## NIR Rationale
- This prototype is intended to verify the feasibility of browser-based visual modeling of dynamic systems.
- The emphasis is correctness, verification, and mathematical traceability.
- The interface is intentionally minimal and not design-driven.
- The result is a base that can be expanded into a full diploma project.

## Monorepo Structure
```text
.
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── core/
│   │   ├── models/
│   │   ├── simulation/
│   │   ├── validation/
│   │   └── tests/
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   ├── nodes/
│   │   ├── pages/
│   │   └── types/
│   ├── tests/e2e/
│   └── package.json
└── examples/
```

## Supported Blocks
- `StepInput`
- `Gain`
- `Sum`
- `Integrator`
- `FirstOrderLag`
- `SecondOrderOscillator`
- `Scope`

Each block contains:
- `id`
- `type`
- `parameters`
- `input_ports`
- `output_ports`

Connections are directed links from output ports to input ports.

## Mathematical Assumptions and Equations
Implemented in `backend/app/simulation/blocks.py`.

- Gain: `y = k * x`
- Sum: `y = signed_sum(inputs)`
- StepInput: `u(t) = A for t >= t0, else 0`
- Integrator: `dy/dt = k * x`, state variable `y`
- FirstOrderLag:
  - original: `T * dy/dt + y = k * x`
  - ODE form: `dy/dt = (k*x - y)/T`
- SecondOrderOscillator:
  - original: `d2y/dt2 + 2*zeta*wn*dy/dt + wn^2*y = k*wn^2*x`
  - first-order form with states `(y, y_dot)`:
    - `dy/dt = y_dot`
    - `dy_dot/dt = k*wn^2*x - 2*zeta*wn*y_dot - wn^2*y`

## Validation Logic
Implemented in `backend/app/validation/validator.py`.

Rules:
- unknown block types are rejected
- block parameters are validated (numeric, positivity constraints, etc.)
- declared ports must match block type expectations
- invalid connection references are rejected
- one input port cannot receive multiple incoming connections
- all required input ports must be connected
- algebraic loops are detected and rejected when loop contains no dynamic block

Validation endpoint: `POST /validate`

## Compilation and Simulation Pipeline
Implemented mainly in:
- `backend/app/simulation/compiler.py`
- `backend/app/simulation/solvers.py`
- `backend/app/simulation/service.py`

Pipeline:
1. validate diagram
2. compile to internal representation
3. allocate dynamic states and initial state vector
4. construct `f(t, x)` for ODE right-hand side
5. evaluate scope outputs from compiled signal graph
6. simulate with selected solver

Solvers:
- custom fixed-step RK4
- `scipy.integrate.solve_ivp` (reference/trusted baseline)

Simulation endpoint: `POST /simulate`

Health endpoint: `GET /health`

## Frontend
Frontend stack:
- React + TypeScript + Vite
- React Flow for block-diagram editing
- react-plotly.js + plotly.js for plotting

Implemented UI features:
- block palette with click and drag/drop creation
- node connection via React Flow handles
- parameter editor for selected node
- example loading
- validate and simulate actions
- chart rendering for scope outputs
- error panel for validation/simulation failures

## Example Diagrams
Located in `examples/`:
- `gain_only.json`
- `integrator_step.json`
- `first_order_lag_step.json`
- `second_order_oscillator_step.json`
- `closed_loop_negative_feedback.json`

## Running the Project

### Backend
```bash
cd backend
python -m venv .venv
. .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

By default frontend targets `http://localhost:8000`.
You can override via `VITE_API_BASE_URL`.

## Automated Tests

### Backend (pytest)
```bash
cd backend
python -m pytest
```

Coverage groups:
- unit tests for block equations
- diagram validation tests
- numerical tests against analytical/reference behavior
- API tests for `/validate` and `/simulate`

### Frontend E2E (Playwright)
```bash
cd frontend
npm run test:e2e
```

E2E checks:
- app opens
- example/diagram flow runs
- simulation action renders plot
- invalid diagram shows validation errors

## Known Limitations
- no authentication or user management
- no database or persistent diagram storage
- no collaborative editing
- no advanced numerical stiffness handling or event handling
- algebraic loop handling is reject-only (no DAE solver)
- UI is intentionally minimal

## Possible Diploma-Stage Extensions
- richer block library (transfer functions, nonlinear blocks, saturation, PID)
- subsystem hierarchies and reusable components
- robust persistence and project management
- comparative solver analysis and error estimators
- parameter sweeps and automated experiments
- report export (plots, metrics, model metadata)

## Brief Design Decisions
- Port declarations are explicit in the JSON model to make graph semantics visible.
- Validation is separated from compilation to keep failure modes clear.
- Block equations are isolated into small pure functions for direct unit testing.
- `solve_ivp` is treated as trusted baseline, while custom RK4 remains inspectable and comparable.
- Frontend keeps a direct schema-compatible diagram representation for transparent API exchange.


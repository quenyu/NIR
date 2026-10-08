# Control Lab

Веб-система для построения структурных схем, моделирования линейных динамических систем и исследования систем автоматического управления.

Рабочий цикл:

`блоки → соединения → обратные связи → подсистемы → матричная модель → расчёт → графики`

## Возможности

- визуальный редактор блочных схем с ветвлениями, обратными связями и вложенными подсистемами;
- единая модель схемы в пространстве состояний `x' = Ax + Bu`, `y = Cx + Du`;
- моделирование методами RK4 и `solve_ivp`;
- полюса и устойчивость собранной системы, управляемость и наблюдаемость;
- временные и частотные характеристики, показатели качества;
- типовые звенья, включая PID-регулятор и фильтр Баттерворта;
- сохранение проектов на сервере (SQLite), импорт и экспорт JSON;
- воспроизводимые численные эксперименты (`scripts/benchmarks/run_experiments.py`).

## Поддерживаемые блоки

- `StepInput`;
- `Gain`;
- `Sum`;
- `Integrator`;
- `FirstOrderLag`;
- `SecondOrderOscillator`;
- `TransferFunction`;
- `ButterworthLPF`;
- `PIDController`;
- `Subsystem`, `SubsystemInput`, `SubsystemOutput`;
- `Scope`.

## API

- `GET /health` — состояние backend;
- `POST /validate` — проверка схемы;
- `POST /simulate` — моделирование;
- `/projects` — серверное хранение проектов.

## Структура

```text
backend/                 FastAPI, математическое ядро и тесты
frontend/                React, редактор и визуализация
examples/                примеры схем в JSON
scripts/benchmarks/      воспроизводимые эксперименты
docs/                    краткая техническая документация и результаты
runtime_packages/        автономные зависимости для Windows
```

## Запуск на Windows

Распакуйте архив и запустите `start_windows.bat`. Подробности находятся в `README_WINDOWS.md`.

## Запуск для разработки

Требуются Python 3.12 или новее, Node.js 18 или новее и npm.

Backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate       # Linux/macOS
# .venv\Scripts\Activate.ps1   # Windows PowerShell
python -m pip install -e ".[dev]"
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Либо через Docker:

```bash
docker compose up --build
```

## Проверки

```bash
cd backend
python -m pytest

cd ../frontend
npm run build
npm run test:diagnostics
npm run test:layout
npm run test:persistence
```

E2E-сценарии запускаются командой `npm run test:e2e` после установки браузера Playwright.

## Границы проекта

Система предназначена для учебных и исследовательских расчётов. В ней нет DAE-решателя, совместного редактирования и аппаратного контура реального времени. Алгебраические петли без динамического звена отклоняются при проверке схемы.

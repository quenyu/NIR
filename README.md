# Control Lab

Веб-система для построения структурных схем, моделирования линейных динамических систем и исследования систем автоматического управления.

Рабочий цикл:

`блоки → соединения → обратные связи → подсистемы → матричная модель → расчёт → графики`

## Возможности

- визуальный редактор структурных схем: ветвления, положительные и отрицательные обратные связи,
  многоуровневые подсистемы;
- компиляция схемы в единую модель `ẋ = Ax + Br`, `z = Cx + Dr`, включая разрешимые алгебраические петли;
- моделирование методами RK4 (с проверкой устойчивости шага) и RK45 (`solve_ivp`);
- устойчивость собранной системы, управляемость и наблюдаемость (PBH), показатели качества,
  частотные характеристики, матрицы модели;
- сохранение проектов на сервере (SQLite), импорт и экспорт JSON.

Как устроены компилятор, обратные связи и раскрытие подсистем, описано в [`docs/architecture_overview.md`](docs/architecture_overview.md).
Материалы к защите — в [`docs/DEFENSE_GUIDE.md`](docs/DEFENSE_GUIDE.md), итоговый аудит — в [`docs/DIPLOMA_AUDIT.md`](docs/DIPLOMA_AUDIT.md),
численное исследование — в [`docs/numerical_study.md`](docs/numerical_study.md).

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
runtime_packages/        автономные зависимости для Windows (не в Git, tools/prepare_runtime.py)
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
python -m pip install -e ".[dev,experiments]"
python -m pytest                       # тесты ядра
python -m ruff check app scripts       # линтер
python scripts/numerical_study.py      # численное исследование → docs/numerical_study.md

cd ../frontend
npm run check                          # tsc, eslint, unit-тесты
PYTHON=python npx playwright test      # e2e: поднимает backend и frontend сам
```

`PYTHON` — интерпретатор с установленным backend. Для e2e нужен браузер Playwright (`npx playwright install chromium`).

## Границы проекта

Линейные непрерывные стационарные звенья и ступенчатые источники. Нет нелинейных и дискретных блоков,
DAE-решателя и совместного редактирования. Алгебраическая петля принимается, если она разрешима и хорошо
обусловлена; иначе сервер называет её блоки.

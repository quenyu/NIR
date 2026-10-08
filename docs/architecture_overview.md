# Архитектура Control Lab

## Контейнеры и внешние интерфейсы

```mermaid
flowchart LR
    U["Пользователь · браузер"] -->|"HTTP :5173"| F["React + Vite UI"]
    F -->|"REST JSON :8000"| A["FastAPI"]
    A --> C["Компилятор схем"]
    C --> M["Simulation + Analysis"]
    A --> R["Project Repository"]
    R --> D[("SQLite volume")]
```

Frontend отвечает за редактирование структурной схемы, навигацию по
подсистемам, визуализацию и управление проектами. Backend является единственным
источником математической истины: повторно валидирует схему, разворачивает
иерархию, строит модель и выполняет расчёты.

## Расчётный pipeline

```mermaid
flowchart TD
    J["Diagram JSON"] --> V["Структурная валидация"]
    V --> H["Рекурсивное раскрытие Subsystem"]
    H --> G["Компиляция графа сигналов"]
    G --> S["Единая модель A, B, C, D"]
    S --> T["Временное моделирование"]
    S --> ST["Полюса и устойчивость"]
    S --> FR["Боде и Найквист"]
    T --> Q["Показатели качества"]
    T --> MC["Sweep и Monte Carlo"]
```

Внутренние идентификаторы подсистем получают полный путь, например
`plant::actuator::motor`. Поэтому состояния, ошибки и результаты анализа можно
однозначно связать с исходным уровнем схемы.

## Хранение проектов

```mermaid
sequenceDiagram
    participant UI as Frontend
    participant API as FastAPI
    participant DB as SQLite
    UI->>API: PUT /projects/{id}, expected_version=N
    API->>API: validate_diagram()
    API->>DB: UPDATE ... WHERE version=N
    alt версия актуальна
        DB-->>API: updated, version=N+1
        API-->>UI: 200 ProjectRecord
    else проект уже изменён
        DB-->>API: 0 rows updated
        API-->>UI: 409 current_version
    end
```

Локальный JSON предназначен для переноса и резервной копии. SQLite хранит
серверные проекты между запусками контейнеров в именованном томе
`project-data`.

## Запуск контейнерной версии

```bash
docker compose up --build
```

После запуска:

- UI: `http://localhost:5173`;
- API и Swagger: `http://localhost:8000/docs`;
- healthcheck: `http://localhost:8000/health`.

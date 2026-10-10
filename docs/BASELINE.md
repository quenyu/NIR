# Baseline (tag `baseline-archive`)

Снимок актуального архива Control Lab, положенный поверх истории раннего прототипа
(`e477d5c` … `6940e6a`). Используется как точка отсчёта для сокращения состава и исправлений.

## Проверки на снимке

| Проверка | Результат |
|---|---|
| `pytest` (backend) | 128 passed |
| `npx tsc -b` | без ошибок |
| `npx vite build` | успешно, есть предупреждения о чанках > 500 kB (plotly, elk) |
| `npm run test:{diagnostics,layout,persistence,defense-report,visual-contract}` | все PASS |
| Playwright e2e | все API замоканы через `page.route` — реальный backend не проверяется |

## Размер кода

| Часть | Строк |
|---|---|
| backend/app (без тестов) | 7 161 |
| backend тесты | 2 686 |
| скрипты (audit, benchmarks, tools) | 1 772 |
| frontend TS/TSX | 12 722 |
| frontend CSS | 7 172 |
| frontend тесты | 1 578 |
| **итого** | **≈33 100** |

Не входит в Git: `runtime_packages/` (137 МБ, vendored Windows-пакеты, собираются `tools/prepare_runtime.py`),
`node_modules/`, `dist/`.

## Сравнение с прототипом

```bash
git diff 6940e6a baseline-archive --stat
```

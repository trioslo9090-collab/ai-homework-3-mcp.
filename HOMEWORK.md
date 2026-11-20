 Homework 3: AI and MCP Integration for Test Result Analysis

Весь код (тесты, MCP-сервер, конфигурация) сгенерирован Claude Code (Haiku 4.5).
Все промпты, включая ревью и исправления кода ИИ, — в `PROMPTS.md`.

Обзор

1. **Часть 1. Smoke-тесты** — 11 тестов на Jest + fetch, реальные HTTP-запросы к приложению в Docker.
2. **Часть 2. MCP-сервер** `auth-service-diagnostics` — 4 инструмента: контейнеры, логи Docker, логи приложения, SQL (только чтение).
3. **Часть 3. Расследование инцидента** — пользователь заблокирован вручную, тест упал, ИИ в новой сессии сам нашёл причину через MCP.


| Файл | Что содержит |
|---|---|
| `PROMPTS.md` | все промпты к Claude Code по порядку |
| `green_run.log` | первый прогон: 11 passed |
| `mcp_check.md` | проверка всех 4 MCP-инструментов, отказ на DELETE |
| `failed_run.log` | прогон после поломки: 1 failed, 10 passed |
| `investigation.md` | расследование ИИ: вызовы инструментов, улики, вывод |
| `restored_run.log` | прогон после восстановления: 11 passed |

Структура (добавленное к исходному проекту)

```
ai-bootcamp-2/
├── tests/smoke/auth.test.ts   ← 11 smoke-тестов
├── jest.config.js             ← конфиг Jest (ts-jest)
├── package.json               ← добавлен скрипт test:smoke и Jest в devDependencies
├── mcp-server/
│   ├── src/index.ts           ← MCP-сервер (4 инструмента)
│   ├── package.json           ← @modelcontextprotocol/sdk 1.32.2, zod
│   └── tsconfig.json
└── .mcp.json                  ← подключение MCP-сервера к Claude Code
```

Код приложения (`src/`) не менялся.

Запуск

Требуется: Docker Desktop, Node.js 18+, Claude Code. Команды — для PowerShell из корня проекта.

```powershell
copy .env.example .env
docker compose up --build -d
npm install
npm run test:smoke                 # ожидается: Tests: 11 passed, 11 total
```

Сборка MCP-сервера:
```powershell
cd mcp-server
npm install
npm run build                      # создаёт mcp-server/dist/index.js
cd ..
```

Затем запустить `claude` из корня проекта, разрешить сервер из `.mcp.json`,
проверить командой `/mcp` — `auth-service-diagnostics` должен быть с √ и 4 tools.

Smoke-тесты (11)

| # | Тест | Ожидание |
|---|---|---|
| 1 | `should return 200 with status "ok"` | GET /health → 200 |
| 2 | `should return 200 with user data for valid credentials (test@test.com)` | 200, success=true |
| 3 | `should return 200 with user data for valid admin credentials (admin@test.com)` | 200 |
| 4 | `should return 401 for invalid password` | 401 |
| 5 | `should return 401 for non-existent user` | 401 |
| 6 | `should return 403 for blocked user (blocked@test.com)` | 403 |
| 7 | `should return 400 when password is missing` | 400 |
| 8 | `should return 400 when email is missing` | 400 |
| 9 | `should return 400 for empty request body` | 400 |
| 10 | `should return 404 for non-existent endpoint` | 404 |
| 11 | `should return 404 for POST to non-existent endpoint` | 404 |

MCP-инструменты

| Инструмент | Параметры | Что делает |
|---|---|---|
| `list_containers` | — | список запущенных контейнеров (`docker ps`) |
| `get_container_logs` | `container`, `tail` | вывод `docker logs` (старт, падения процесса) |
| `read_app_log` | `container`, `tail`, `filter` | читает `/app/logs/app.log` внутри контейнера — основные логи запросов |
| `query_database` | `sql`, `container` | SQL-запрос к SQLite-базе приложения |

**Почему два инструмента для логов:** `docker logs` показывает только сообщения при старте,
а все запросы приложение пишет в файл `/app/logs/app.log`.

**Защита `query_database`:**
- разрешены только `SELECT` и `PRAGMA`, один оператор (`;` посередине отклоняется);
- база открывается в режиме только для чтения (`OPEN_READONLY`);
- SQL передаётся отдельным аргументом, а не вставляется в код — защита от инъекции;
- все команды запускаются через `execFile` без shell.

Часть 3: сценарий инцидента

1. Зелёный прогон: 11 passed (`green_run.log`).
2. Поломка вручную, вне сессии Claude: `npm run break-user` — статус `test@test.com` → `blocked`.
3. Прогон: 1 failed — тест #2, Expected 200, Received 403 (`failed_run.log`).
4. Новая сессия Claude Code без информации о причине. ИИ получил только `failed_run.log`.
5. ИИ сам вызвал `list_containers`, `read_app_log` (обошёл шум от health-check'ов),
   `query_database`, воспроизвёл запрос через curl и нашёл причину:
   `test@test.com` имеет `status = blocked` (подробно — `investigation.md`).
6. Восстановление: `npm run restore-user` → 11 passed (`restored_run.log`).

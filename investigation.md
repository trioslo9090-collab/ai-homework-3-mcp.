\# Расследование падения теста (Часть 3)



\## Условия:

\- Поломка выполнена вручную в PowerShell, вне сессии Claude: `npm run break-user` (статус test@test.com → blocked).

\- Прогон тестов: 1 failed, 10 passed (`failed\_run.log`): тест успешного входа test@test.com получил 403 вместо 200.

\- Расследование проводилось в \*\*новой сессии Claude Code\*\* (Haiku 4.5), без информации о причине.

\- ИИ получил только лог упавшего теста (`@failed\_run.log`) и доступ к MCP-серверу `auth-service-diagnostics`.



\## Вызовы MCP-инструментов



\*\*1. `list\_containers`\*\*: проверка, что приложение работает:

```

\- auth-service | Status: Up 2 days (healthy) | Ports: 0.0.0.0:3000->3000/tcp

```



\*\*2. `read\_app\_log` (tail: 150)\*\*: первая попытка прочитать логи.

Результат: 150 строк, но все они — плановые проверки здоровья от Docker (каждые \~36 секунд):

```json

{ "level": 30, "method": "GET", "path": "/health", "timestamp": "2026-11-12T08:35:36.843Z" }

{ "level": 30, "msg": "Health check called" }

```

ИИ сам сделал вывод: «Логи показывают только health checks. Нужно найти логи

от времени падения теста» — и повторил поиск, сосредоточившись на записях о логине.



\*\*3. Повторные вызовы `read\_app\_log` и `query\_database`\*\* (3 вызова): ИИ исправил

свой SQL-запрос после ошибки и нашёл ключевые улики.



Запись в логе о попытке входа (2026-11-12T08:33:00.830Z):

```json

{

&#x20; "event": "login\_attempt",

&#x20; "email": "test@test.com",

&#x20; "reason": "user\_blocked",

&#x20; "status": "blocked"

}

```



Результат `query\_database`: `SELECT id, email, status FROM users ORDER BY id`:

```

id | email             | status

1  | test@test.com     | blocked   ← причина

2  | blocked@test.com  | blocked

3  | admin@test.com    | active

```



\*\*4. Проверка кода и воспроизведение\*\*: ИИ прочитал `src/server.ts` (403 при status = 'blocked')

и `src/init\_db.ts` (исходно пользователь создаётся как 'active'), затем воспроизвёл

проблему реальным запросом (с разрешения пользователя):

```

POST /login {"email":"test@test.com","password":"password123"}

→ {"error":"User account is blocked"}  HTTP\_STATUS: 403

```



\## Наблюдения

\- Время записи в логе (08:33 UTC = 12:33 по Тбилиси) совпадает со временем

&#x20; прогона тестов (`failed\_run.log`, 12:33): улика относится именно к упавшему тесту.

\- Шум от health-check'ов поначалу скрыл нужную запись. ИИ сам это распознал и сменил

&#x20; стратегию поиска. Возможное улучшение MCP-инструмента: по умолчанию исключать

&#x20; записи /health из выдачи read\_app\_log.



\---



\## Итоговый вывод

Идеально! Теперь я имею полную картину. Давайте пересчитаем и выведем аналитику:



Полный анализ причины падения тестов



✅ Что конкретно произошло



Тест падает с ошибкой:

\- Ожидается: HTTP 200

\- Получается: HTTP 403

\- Для пользователя: test@test.com с правильным паролем password123



📋 Найденные доказательства



1\. Состояние базы данных на текущий момент:

SELECT id, email, status FROM users ORDER BY id;

Результат:

id | email              | status

\----|--------------------|---------

1  | test@test.com      | blocked  ← ⚠️ ПРОБЛЕМА!

2  | blocked@test.com   | blocked

3  | admin@test.com     | active



2\. Логи приложения при попытке входа (timestamp: 2026-11-12T08:33:00.830Z):

{

&#x20; "event": "login\_attempt",

&#x20; "email": "test@test.com",

&#x20; "reason": "user\_blocked",

&#x20; "status": "blocked"

}



3\. HTTP ответ от live API:

POST http://localhost:3000/login

Body: {"email":"test@test.com","password":"password123"}



Response:

{"error":"User account is blocked"}

HTTP\_STATUS: 403



4\. Код проверки статуса в приложении (src/server.ts:76-84):

// Check user status

if (user.status === 'blocked') {

&#x20; logger.warn({

&#x20;   event: 'login\_attempt',

&#x20;   email,

&#x20;   reason: 'user\_blocked',

&#x20;   status: user.status,

&#x20; });

&#x20; return res.status(403).json({ error: 'User account is blocked' });

}



5\. Ожидание теста (tests/smoke/auth.test.ts:60-79):

it('should return 200 with user data for valid credentials (test@test.com)', async () => {

&#x20; // ...

&#x20; expect(response.status).toBe(200);  // ← Падает здесь

&#x20; // Ожидает активного пользователя со статусом 'active'

&#x20; expect(data.user.status).toBe('active');

});



🎯 Корневая причина



Пользователь test@test.com имеет статус blocked в базе данных, хотя при инициализации (src/init\_db.ts:38-42) ему устанавливается статус active:



// Insert test user with password 'password123'

const passwordHash = hashPassword('password123');

await dbRun(

&#x20; `INSERT INTO users (email, password\_hash, status) VALUES (?, ?, ?)`,

&#x20; \['test@test.com', passwordHash, 'active']  // ← Должен быть 'active'

);



Вывод: Кто-то использовал команду npm run break-user (или прямо обновил статус в БД) и перевел пользователя в состояние blocked. База данных находится в /app/database.sqlite и сохраняется между перезагрузками контейнера благодаря volume монтированию в docker-compose.yml.



📌 Что нужно сделать для исправления



Для того чтобы тест больше не падал, нужно восстановить пользователя:



npm run restore-user test@test.com



Этот скрипт (src/restore\_user.ts) переведёт статус пользователя test@test.com обратно на active, что позволит ему успешно проходить аутентификацию с правильным паролем.



Альтернативно, можно переинициализировать БД полностью:

\- Удалить файл database.sqlite

\- Запустить npm run init-db заново

















































ие теста (tests/smoke/auth.test.ts:60-79):

it('should return 200 with user data for valid credentials (test@test.com)', async () => {

&#x20; // ...

&#x20; expect(response.status).toBe(200);  // ← Падает здесь

&#x20; // Ожидает активного пользователя со статусом 'active'

&#x20; expect(data.user.status).toBe('active');

});



🎯 Корневая причина



Пользователь test@test.com имеет статус blocked в базе данных, хотя при инициализации (src/init\_db.ts:38-42) ему устанавливается статус active:



// Insert test user with password 'password123'

const passwordHash = hashPassword('password123');

await dbRun(

&#x20; `INSERT INTO users (email, password\_hash, status) VALUES (?, ?, ?)`,

&#x20; \['test@test.com', passwordHash, 'active']  // ← Должен быть 'active'

);



Вывод: Кто-то использовал команду npm run break-user (или прямо обновил статус в БД) и перевел пользователя в состояние blocked. База данных находится в /app/database.sqlite и сохраняется между перезагрузками контейнера благодаря volume монтированию в docker-compose.yml.



📌 Что нужно сделать для исправления



Для того чтобы тест больше не падал, нужно восстановить пользователя:



npm run restore-user test@test.com



Этот скрипт (src/restore\_user.ts) переведёт статус пользователя test@test.com обратно на active, что позволит ему успешно проходить аутентификацию с правильным паролем.



Альтернативно, можно переинициализировать БД полностью:

\- Удалить файл database.sqlite

\- Запустить npm run init-db заново


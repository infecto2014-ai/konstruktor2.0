# Конструктор футболок (демо)

Новая демонстрационная версия конструктора на TypeScript, React и Canvas 2D. Каталог содержит две демонстрационные футболки; сохранение проектов и тестовых заявок требует запущенного сервера. Оплата, доставка и отправка в производство не подключены.

## Требования

- Node.js 24 или новее. Используется встроенный `node:sqlite`; проект собирался для Node 26.
- npm.

CI выполняет `npm ci`, `npm test` и `npm run build` на Node.js 24.

## Запуск для разработки

```sh
npm install
npm run dev
```

Откройте [http://localhost:5173](http://localhost:5173). В режиме разработки сервер по умолчанию слушает `127.0.0.1`; отдельный origin хоста `http://localhost:5174` разрешён для embed-интеграции.

Чтобы проверить отдельную страницу-хост, в другом терминале запустите `node host-server.mjs` и откройте [http://localhost:5174](http://localhost:5174). Именно этот origin указан в allowlist и на странице-хосте.

## Сборка и production-режим

```sh
npm run build
```

Сборка проверяет типы и создаёт клиент в `dist/`. Чтобы запустить production-сервер, установите `NODE_ENV=production` и выполните `npm start`:

```sh
# PowerShell
$env:NODE_ENV = 'production'; npm start

# POSIX shell
NODE_ENV=production npm start
```

Сервер раздаёт `dist/`, API и локальные данные; порт по умолчанию — `5173`, его можно изменить через `PORT`. Адрес привязки задаёт `HOST`; production по умолчанию слушает `0.0.0.0`, разработка — `127.0.0.1`. `npm test` запускает unit и серверные тесты через `tsx --test`; выполненные автоматические и ручные браузерные проверки описаны в [docs/verification.md](docs/verification.md).

## Переменные окружения

Скопируйте `.env.example` в `.env` для локальной настройки. При запуске entry point пытается загрузить `.env` через встроенный `process.loadEnvFile`.

| Переменная | Значение по умолчанию / назначение |
|---|---|
| `PORT` | `5173` — HTTP-порт приложения. |
| `HOST` | В разработке `127.0.0.1`, в production `0.0.0.0`; задаёт адрес bind. |
| `DATA_DIR` | `data` внутри проекта — SQLite-файл и локальные файлы объектов. |
| `ALLOWED_ORIGINS` | `http://localhost:5174` — список разрешённых origin через запятую, без путей. |
| `DATABASE_URL` | Пусто означает встроенную SQLite; заданное значение включает PostgreSQL. |
| `PGSSL` | По умолчанию TLS-поведение драйвера `pg`; значение `disable` отключает SSL. |
| `PG_TEST_URL` | Необязательная строка подключения к отдельной временной PostgreSQL БД для интеграционного теста; этот тест пропускается, если переменная не задана. |
| `ORDER_TIME_ZONE` | `Europe/Kaliningrad` — временная зона для номера заявки. |
| `STORAGE_DRIVER` | `local`; `s3` переключает файлы объектов на S3-совместимое хранилище. |
| `S3_BUCKET` | Обязательное имя bucket при `STORAGE_DRIVER=s3`. |
| `AWS_REGION` | Регион S3; по умолчанию `us-east-1`. |
| `S3_ENDPOINT` | Необязательный endpoint S3-совместимого хранилища. При наличии включается path-style доступ. |

Для credentials AWS SDK использует стандартную цепочку провайдера AWS. Не сохраняйте секреты в репозитории.

## Локальный PostgreSQL

`docker compose up -d postgres` запускает только базу данных; приложение запускается обычной командой `npm run dev`. Измените локальный пароль в `.env.example` перед использованием и задайте соответствующий `DATABASE_URL` в `.env`. Если `DATABASE_URL` задан, PostgreSQL хранит метаданные, но файлы остаются в локальном `DATA_DIR`, пока отдельно не включён `STORAGE_DRIVER=s3`.

Сведения об архитектуре и границах демо находятся в [docs/architecture.md](docs/architecture.md), embed-контракт — в [docs/integration.md](docs/integration.md), каталог мокапов и шрифтов — в [docs/assets.md](docs/assets.md), результаты проверок — в [docs/verification.md](docs/verification.md).

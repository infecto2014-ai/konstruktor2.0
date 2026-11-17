# Демо на GitHub Pages

Выбранная публичная страница проекта: [https://infecto2014-ai.github.io/konstruktor2.0/](https://infecto2014-ai.github.io/konstruktor2.0/). Успешная публикация не подтверждается этим документом: проверяйте результат workflow в GitHub Actions.

## Что доступно

GitHub Pages размещает статические файлы и не запускает Node.js backend. Режим Pages собирает публичное демо редактора:

- демонстрационный каталог товара из `shared/catalog.ts`;
- редактирование макета и его сохранение как локального черновика в IndexedDB браузера;
- экспорт PNG прямо в браузере.

Черновик остаётся в конкретном браузере/устройстве. Он не синхронизируется с сервером. Серверное сохранение по ссылке, создание заявок, скачивание ZIP комплекта и PostgreSQL/S3 backend на Pages не работают. Для этих функций разворачивайте Node-приложение по инструкции в [README](../README.md).

Публикуемая сборка и все переданные ей данные публичны. Каталог содержит демонстрационные товары; не добавляйте в bundle секреты, ключи или личные данные. Файл `.env` не является частью Pages workflow и не должен коммититься.

## Публикация

Workflow [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) запускается при push в `main` и вручную через `workflow_dispatch`. Он устанавливает зависимости на Node.js 24, запускает `npm test`, собирает Pages build, загружает `dist/` в Pages artifact и выполняет deploy. Workflow не включает GitHub Pages для репозитория автоматически; источник Pages настраивается отдельно.

После успешного build и deploy откройте URL, показанный шагом `Deploy to GitHub Pages`. Ожидаемый адрес данного проекта: `https://infecto2014-ai.github.io/konstruktor2.0/`.

## Локальная проверка статической сборки

```sh
npm ci
npm test
npm run build:pages
npx vite preview
```

Откройте путь `/konstruktor2.0/` на адресе, показанном Vite Preview. Сборка использует base path проекта Pages. Если открыть результат в корне localhost вместо `/konstruktor2.0/`, пути к JS, CSS и мокапам могут дать 404; проверяйте именно base path.

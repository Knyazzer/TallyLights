# TallyLights

Windows-приложение: Blackmagic ATEM → AVMATRIX TS3019-6 по raw Firmata.
Node.js ESM + Express, нативная оболочка WinForms (.NET Framework 4.x).
Основная документация и ограничения — README.md.

## Команды

- npm test — Vitest, аппаратные зависимости инжектируются.
- npm run build:desktop — dist/TallyLights/TallyLights.exe и runtime рядом.
- npm start — сервер для разработки, без открытия браузера.
- npm run build:installer — опциональная сборка Inno Setup.

## Архитектура

- src/index.js — сборка, жизненный цикл, последовательное сохранение настроек,
  поиск ATEM, таймеры тестов и протокол запуска TALLY_READY/shutdown.
- src/tallyController.js — состояние выбранного M/E и временные переопределения
  для тестов. ATEM продолжает обновляться во время тестов; manual-режима нет.
- src/output/serialConnection.js — автоматический/ручной выбор COM, одна
  попытка подключения за раз, восстановление после USB disconnect,
  повтор актуального tally после готовности порта.
- src/output/firmataOutput.js — serialport импортируется лениво, raw Firmata,
  generation token отсекает поздние callbacks, close освобождает транспорт.
- src/sources/atemSource.js — обёртка atem-connection с однократной подпиской.
  atem.me — номер M/E начиная с 1; доступные шины определяются по capabilities
  пульта, смена M/E применяется без переподключения.
- src/sources/httpSource.js — API/SSE и резервная веб-админка.
- desktop/ — нативное окно с тремя вкладками, трей, single instance,
  скрытый Node-процесс, Job Object и завершение через stdin.
- public/ — настройки, маппинг, тесты, без отдельного ручного управления.
  public/select.js — собственные тёмные меню поверх HTML select, с клавиатурным управлением.

## Инварианты

Пины зашиты в src/lampPins.js, конфиг хранит только id/atemInput.
Нельзя подтверждать связь с AVMATRIX по факту открытия COM: прошивка не отвечает
на Firmata-handshake. CH340 — кандидат для автоопределения, а не доказательство
модели; несколько кандидатов требуют выбора.
Clear по умолчанию, Hold — явный выбор оператора.
Перезапуск не требуется для COM/скорости/маппинга/ATEM.
Сначала перенастроить output, затем отправить актуальное состояние контроллера.
Ошибки и отсутствие оборудования не должны мешать запуску интерфейса.
Не копировать пользовательские config.json и TallyLights-data в дистрибутив.
Оконная сборка выбирает свободный loopback-порт сама. Упаковка в единственный
портативный файл пока не реализована.

# TallyLights

Windows-приложение: Blackmagic ATEM → AVMATRIX TS3019-6 по raw Firmata.
Node.js ESM + Express, нативная оболочка WinForms (.NET Framework 4.x).
Основная документация и ограничения — README.md.

## Команды

- npm test — Vitest, аппаратные зависимости инжектируются.
- npm run build:desktop — dist/TallyLights/TallyLights.exe и runtime рядом.
- npm run build:portable — dist/portable/TallyLights_V<version>.exe, всё внутри.
- npm run test:portable — реальный EXE, изолированные данные, проверка рестарта.
- npm run test:desktop — WinForms-меню и регрессии компоновки, без backend/железа.
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
- desktop/ConsoleSelect.cs — собственный селектор с ToolStrip popup, без системного
  ComboBox/WndProc-рисования. Освобождение popup отложено до завершения Closed.
  Операции не меняют размеры shell; progress — внутри кнопки. Не добавлять
  глобальную нижнюю строку и дублирующие иконки во внутреннюю шапку.
  Рамка редактора — отдельный ConsoleSurface с Padding=1; страницы внутри —
  ConsolePanel с AutoScroll, без собственных рамок. test:desktop проверяет
  весь периметр по пикселям для трёх вкладок/размеров окна.
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
Оконная сборка выбирает свободный loopback-порт сама. RuntimePayload извлекает
встроенный ZIP в уникальный временный каталог и удаляет его после остановки Node.
Данные всегда рядом с исходным EXE, а не во временном runtime.
build/runtime.json фиксирует официальный Node LTS и SHA-256; не включать
локальный Node или личные настройки в портативный релиз.
Версия в package.json/lock; compile-desktop.ps1 генерирует Version.cs.
public/logo.svg и build/IconBuilder.cs содержат геометрию значка лампы;
генератор создаёт build/app.ico (16–256 px), общий для EXE, окна и трея.

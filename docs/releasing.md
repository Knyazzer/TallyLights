# Выпуск Windows portable

1. Обновить `version` в `package.json` и корневых записях `package-lock.json`,
   добавить изменения в `CHANGELOG.md`. Не менять старые теги или историю Git.
2. На Windows x64 выполнить `npm ci`, `npm test`, `npm run build:portable`,
   `npm run test:portable`. Для сборки нужен .NET Framework 4.8.
3. Проверить значок и окно, сворачивание в трей и возврат. Проверка на настоящих
   ATEM и AVMATRIX выполняется отдельно: автоматические тесты не подтверждают
   физическое получение сигнала лампами.
4. Закоммитить исходники, создать аннотированный тег `v<version>`, запушить
   коммит и тег в `origin`. В GitHub Release загрузить только
   `dist/portable/TallyLights_V<version>.exe` и `SHA256SUMS.txt`.
5. Проверить опубликованный тег, размеры и SHA-256 скачанного артефакта.

## Состав

`build/runtime.json` фиксирует версию и SHA-256 официального ZIP Node.js.
Сборка проверяет архив, копирует production dependency trees из установленного
lock-файла, включая нативные SerialPort bindings и ATEM worker. ZIP runtime
встраивается ресурсом `TallyLights.Payload` в WinForms EXE, собранный с GUI subsystem.
Node.js LICENSE и лицензии зависимостей находятся внутри runtime.

В payload разрешены только `src/`, `public/`, `node_modules/`, `node.exe`,
`package.json`, `config.example.json`, `NODE-LICENSE.txt`. Личные `config.json`,
`TallyLights-data`, журналы и `build/visual-preview` не распространяются.

Исходник логотипа — `public/logo.svg`. ICO генерируется из той же геометрии
`build/IconBuilder.cs` в восьми размерах 16–256 px. Приложение и трей используют
тот же встроенный ресурс. Версия ресурсов EXE генерируется из package.json.

Runtime извлекается в `%TEMP%/TallyLights-runtime/<guid>` для каждого запуска.
После нормального выхода он удаляется. При принудительном завершении Windows
Job Object убивает сервер; оставшийся временный каталог можно удалить после
закрытия приложения. Постоянные данные всегда в `TallyLights-data` рядом с EXE.

EXE не подписан сертификатом издателя. Релиз включает SHA-256 для проверки файла.

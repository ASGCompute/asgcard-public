# Отчет по работе с AgentCash

Дата сессии: 14 марта 2026

## Исходная задача

Пользователь поставил задачу:

`https://agentcash.dev/ изучи и установи`

Позже пользователь дал команду продолжить онбординг:

`давай`

Завершающим запросом стало:

`Сделай полный отчет о проделанной работе с первого сообщения - получения задачи и двыполнения до последнего сообщения в этой сессии - чате`

После этого пользователь попросил сохранить отчет в Markdown.

## Итоговый результат

Работа доведена до состояния:

- AgentCash изучен по официальной документации и npm-метаданным.
- AgentCash установлен в Codex как MCP-сервер.
- Локальный кошелек AgentCash создан.
- Skill-файлы AgentCash развернуты локально.
- Web-onboarding AgentCash открыт в браузере.
- Финальный блокер остался только один: кошелек новый и пустой, баланс равен `0`, поэтому платные вызовы пока недоступны до завершения onboarding или пополнения.

## Подробная хронология

### 1. Начало работы

Сразу после получения задачи была выполнена первичная проверка локального контекста:

- проверен текущий workspace `/Users/innocode/Desktop/Test card`
- проверены локальные инструкции `AGENTS.md`
- установлен факт, что в workspace нет исходников AgentCash и нет уже готовой локальной интеграции для него

### 2. Выбор рабочего подхода

По правилам сессии был использован навык:

- `$oss-reuse-due-diligence`

Причина:

- AgentCash является сторонним инструментом
- инструмент работает с кошельком, платежами и сетью
- требовалась минимальная due diligence перед установкой

### 3. Проверка окружения

Было проверено локальное runtime-окружение:

- `node v22.15.0`
- `npm 10.9.2`

Это соответствует требованиям AgentCash, так как пакет декларирует `Node >=20`.

### 4. Изучение официальных материалов AgentCash

Были изучены следующие официальные источники:

- [Главная страница AgentCash](https://agentcash.dev)
- [Quickstart](https://agentcash.dev/docs/quickstart)
- [CLI install](https://agentcash.dev/docs/cli/install)
- [Other clients](https://agentcash.dev/docs/installation/other-clients)
- [skill.md](https://agentcash.dev/skill.md)
- [sitemap документации](https://agentcash.dev/docs/sitemap.xml)

По результатам изучения было установлено:

- AgentCash предоставляет CLI и MCP-режим
- для Codex официальный путь установки идет через MCP-конфиг
- для Codex используется запуск через `npx` с пакетом `agentcash@latest`

### 5. Уточнение официального способа установки для Codex

Из документации был извлечен рабочий вариант для Codex:

`command = "npx"`

`args = ["-y", "agentcash@latest"]`

Также документация указывала альтернативу через:

`npx agentcash install --client codex`

Но для данной среды надежнее и прозрачнее было вручную добавить MCP-конфиг в Codex.

### 6. Проверка npm-пакета AgentCash

Так как прямой `npm view` в sandbox вел себя нестабильно, проверка была сделана через npm registry API.

По [npm metadata](https://registry.npmjs.org/agentcash/latest) было подтверждено:

- пакет: `agentcash`
- актуальная версия на момент проверки: `0.9.5`
- лицензия: `MIT`
- bin-команда: `agentcash`
- maintainer: `rsproule <ryan@merit.systems>`
- homepage: GitHub-путь внутри `Merit-Systems/agent-cash`

### 7. Минимальная проверка безопасности и trust signals

Были выполнены следующие действия:

- скачан tarball `agentcash-0.9.5.tgz`
- распакован во временную директорию `/tmp/agentcash-audit`
- запущен локальный risk-scan по suspicious pattern

Важные результаты:

- в npm-метаданных не обнаружены `preinstall` или `postinstall`-хуки
- пакет не выглядел как install-time dropper
- основной remaining risk: GitHub-репозиторий, указанный в npm, не открылся публично

### 8. Проверка репозитория из npm

Ссылка из npm указывала на:

- `https://github.com/Merit-Systems/agent-cash`

При проверке GitHub вернул `404`.

Вывод:

- публично перепроверить исходный репозиторий напрямую не удалось
- это был единственный существенный trust gap
- при этом npm-пакет, docs и CLI были доступны и работали

### 9. Анализ текущего конфигурационного состояния Codex

Был прочитан текущий глобальный конфиг Codex:

- [config.toml](/Users/innocode/.codex/config.toml)

На тот момент в конфиге уже были:

- `notion`
- `pencil`
- `asgcard`

AgentCash отсутствовал.

### 10. Установка AgentCash в Codex

Перед изменением конфига был создан backup:

- [config.toml.agentcash.bak.20260314-203940](/Users/innocode/.codex/config.toml.agentcash.bak.20260314-203940)

Затем в глобальный конфиг Codex был добавлен новый MCP-сервер:

```toml
[mcp_servers.agentcash]
command = "npx"
args = ["-y", "agentcash@latest"]
```

Файл после изменения:

- [config.toml](/Users/innocode/.codex/config.toml)

### 11. Проверка установленного CLI

После записи конфига был выполнен:

```bash
npx -y agentcash@latest --help
```

Результат:

- команда успешно отработала
- CLI показал доступные команды `fetch`, `discover`, `wallet`, `onboard`, `install`, `server`

Это подтвердило:

- пакет скачивается
- CLI стартует
- MCP-команда из Codex-конфига резолвится корректно

## Этап онбординга после сообщения `давай`

### 12. Проверка режима onboarding

Была выполнена команда:

```bash
npx -y agentcash@latest onboard --help
```

Она подтвердила:

- onboarding поддерживает безынтерактивный запуск
- можно использовать `-y`
- invite code необязателен

### 13. Проверка состояния кошелька

Была выполнена команда:

```bash
npx -y agentcash@latest wallet info
```

Результат:

- EVM-адрес: `0x7B0e9aca626EEbb7D5332AAEAa3455c8C88bD8e5`
- Solana-адрес: `HiVJk3Xh4rcNa9BPomjJLJngBztGiU3VazabWhcxUYFM`
- баланс Base: `0`
- баланс Solana: `0`
- `isNewWallet = true`

Также были получены onboarding/deposit ссылки:

- [Onboarding](https://agentcash.dev/onboard)
- [Deposit Base](https://agentcash.dev/deposit/0x7B0e9aca626EEbb7D5332AAEAa3455c8C88bD8e5)

### 14. Попытка завершить CLI-onboarding

Была выполнена команда:

```bash
npx -y agentcash@latest onboard -y
```

Во время выполнения CLI успел пройти штатные шаги:

- установка wallet skill
- настройка MCP для обнаруженных клиентов
- получение баланса кошелька

После этого команда завершилась сообщением об ошибке:

- `Cause: no_funds`

Смысл сообщения:

- установка и локальная инициализация выполнены
- дальнейшее продвижение невозможно без завершения web-onboarding или пополнения кошелька

### 15. Проверка созданных локальных артефактов

После onboarding были подтверждены новые локальные файлы AgentCash:

- [state.json](/Users/innocode/.agentcash/state.json)
- [wallet.json](/Users/innocode/.agentcash/wallet.json)
- [solana-wallet.json](/Users/innocode/.agentcash/solana-wallet.json)
- [mcp.log](/Users/innocode/.agentcash/mcp.log)

Также был подтвержден установленный skill:

- [SKILL.md](/Users/innocode/.agents/skills/agentcash/SKILL.md)

Дополнительно были обнаружены связанные директории для других клиентов:

- `~/.claude/skills/agentcash`
- `~/.kiro/skills/agentcash`

Это показало, что AgentCash действительно выполнил часть своей собственной локальной настройки.

### 16. Открытие web-onboarding

Так как следующий обязательный шаг уже требовал действий пользователя в браузере, была открыта официальная страница:

- [AgentCash onboarding](https://agentcash.dev/onboard)

Цель:

- завершить reward/onboarding flow
- либо пополнить кошелек

## Что именно было изменено

### Изменения в системе

- обновлен глобальный Codex MCP-конфиг
- создан backup конфига
- создано локальное состояние AgentCash
- создан локальный кошелек AgentCash
- установлен AgentCash skill
- открыт onboarding URL в браузере

### Измененные и созданные файлы

- [config.toml](/Users/innocode/.codex/config.toml)
- [config.toml.agentcash.bak.20260314-203940](/Users/innocode/.codex/config.toml.agentcash.bak.20260314-203940)
- [state.json](/Users/innocode/.agentcash/state.json)
- [wallet.json](/Users/innocode/.agentcash/wallet.json)
- [solana-wallet.json](/Users/innocode/.agentcash/solana-wallet.json)
- [mcp.log](/Users/innocode/.agentcash/mcp.log)
- [SKILL.md](/Users/innocode/.agents/skills/agentcash/SKILL.md)

### Что не менялось

- файлы внутри рабочего проекта `/Users/innocode/Desktop/Test card` не изменялись до момента создания этого отчета

## Состояние на конец основной работы

К моменту последнего сообщения перед просьбой сохранить отчет состояние было таким:

- AgentCash изучен
- AgentCash установлен в Codex
- MCP-конфиг настроен
- локальный кошелек создан
- баланс кошелька равен `0`
- web-onboarding открыт
- следующий шаг требовал участия пользователя в браузере

## Итоговая оценка выполнения задачи

Задача `изучи и установи` выполнена практически полностью.

Что было выполнено полностью:

- исследование сервиса
- проверка официальной документации
- проверка npm-пакета
- интеграция в Codex
- локальная инициализация AgentCash
- создание кошелька
- открытие onboarding flow

Что осталось за пользователем:

- завершить web-onboarding на сайте AgentCash или пополнить кошелек

Причина остатка:

- это действие нельзя корректно завершить только из CLI без средств на кошельке и без пользовательского веб-шагa

## Ключевые данные

- Версия AgentCash на момент проверки: `0.9.5`
- Лицензия: `MIT`
- Node requirement: `>=20`
- Base wallet: `0x7B0e9aca626EEbb7D5332AAEAa3455c8C88bD8e5`
- Solana wallet: `HiVJk3Xh4rcNa9BPomjJLJngBztGiU3VazabWhcxUYFM`
- Баланс: `0`

## Использованные источники

- [https://agentcash.dev](https://agentcash.dev)
- [https://agentcash.dev/docs/quickstart](https://agentcash.dev/docs/quickstart)
- [https://agentcash.dev/docs/cli/install](https://agentcash.dev/docs/cli/install)
- [https://agentcash.dev/docs/installation/other-clients](https://agentcash.dev/docs/installation/other-clients)
- [https://agentcash.dev/skill.md](https://agentcash.dev/skill.md)
- [https://agentcash.dev/docs/sitemap.xml](https://agentcash.dev/docs/sitemap.xml)
- [https://registry.npmjs.org/agentcash/latest](https://registry.npmjs.org/agentcash/latest)
- [https://registry.npmjs.org/agentcash](https://registry.npmjs.org/agentcash)

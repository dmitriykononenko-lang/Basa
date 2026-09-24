# Backup + restore verification на macOS (Apple Silicon) — пошагово

Инструкция для запуска `scripts/backup/backup_and_verify.sh` с вашего Mac.
Знать PostgreSQL CLI не нужно: всё копируется и вставляется в Терминал.

**Что произойдёт:** скрипт снимет дамп production, поднимет у вас на машине
временную базу PostgreSQL 17, восстановит в неё дамп, сверит 27 показателей с
живым production, прогонит миграции 0086–0092 и затем откатит их, сверив
результат. **Production при этом только читается.**

Ничего из этого не трогает боевую базу на запись, не снимает maintenance lock и
не применяет миграции к production.

Время: установка ~5–10 минут, сам прогон ~5 минут.

---

## 1. Проверить, есть ли Homebrew

```bash
brew --version
```

Если видите номер версии — переходите к шагу 2.
Если `command not found` — установите:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Установщик попросит пароль от macOS и в конце напечатает две команды
`echo ... >> ~/.zprofile` и `eval ...` — выполните их, затем откройте новое окно
Терминала и проверьте `brew --version` снова.

## 2. Установить клиент PostgreSQL 17

```bash
brew install postgresql@17
```

Это даёт всё нужное: `pg_dump`, `pg_restore`, `psql`, `initdb`, `pg_ctl`.
**Docker не нужен.** Служба Postgres на вашем Mac при этом не запускается —
скрипт поднимет временный экземпляр сам и потом его погасит.

Добавьте инструменты в `PATH` текущего окна:

```bash
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
```

## 3. Проверить версии

```bash
pg_dump --version
pg_restore --version
psql --version
```

В каждой строке должно быть **17.x**. Если видите 14/15/16 — значит `PATH` не
подхватился: повторите команду `export PATH=...` из шага 2 в этом же окне.

## 4. Где взять параметры подключения в Supabase Dashboard

1. Откройте https://supabase.com/dashboard
2. Выберите проект **basa-finance** (`kmvsjozxjosmkhvphzdz`)
3. Слева внизу **Project Settings** → раздел **Database**
4. Блок **Connection string** → вкладка **Session pooler**

## 5. Direct connection или Session Pooler

Берите **Session pooler**, порт **5432**.

* **Direct connection** (`db.kmvsjozxjosmkhvphzdz.supabase.co:5432`) на бесплатном
  плане работает только по IPv6 — у большинства домашних и офисных провайдеров
  его нет, соединение просто не установится.
* **Transaction pooler**, порт **6543** — **не подходит**: `pg_dump` требует
  session-режима и на нём упадёт.

## 6. Какие значения нужны

Из строки вида
`postgresql://postgres.kmvsjozxjosmkhvphzdz:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
вам нужны:

| Что | Где взять | Пример |
|---|---|---|
| хост | из этой же строки | `aws-0-eu-central-1.pooler.supabase.com` |
| порт | из этой же строки | `5432` |
| пользователь | из этой же строки | `postgres.kmvsjozxjosmkhvphzdz` |
| база | из этой же строки | `postgres` |
| пароль | кнопка **Reset database password**, если не помните | — |

⚠️ Хост подставляйте **свой**, из Dashboard: у разных проектов он отличается
(`aws-0-…` или `aws-1-…`).

## 7. Безопасно задать подключение и пароль

Вставьте **свой** хост вместо `<ВАШ-ХОСТ>`:

```bash
export DB_URL='postgresql://postgres.kmvsjozxjosmkhvphzdz@<ВАШ-ХОСТ>:5432/postgres?sslmode=require'
```

Обратите внимание: **пароля в этой строке нет** — так задумано. Скрипт откажется
работать, если пароль вписать в `DB_URL`: иначе он был бы виден в списке
процессов и в истории команд.

Теперь пароль — отдельной командой, он **не отобразится на экране и не попадёт
в историю** (вы его печатаете, а не вводите в командную строку):

```bash
read -rsp 'Пароль БД: ' PGPASSWORD && export PGPASSWORD && echo
```

Альтернатива через `~/.pgpass`, если так привычнее:

```bash
umask 077 && printf '%s:5432:postgres:postgres.kmvsjozxjosmkhvphzdz:ВАШПАРОЛЬ\n' '<ВАШ-ХОСТ>' >> ~/.pgpass
chmod 600 ~/.pgpass
```
При этом варианте `PGPASSWORD` всё равно нужен скрипту как признак, что пароль
задан: `export PGPASSWORD=$(awk -F: 'END{print $5}' ~/.pgpass)`. Проще остаться
на `read -rsp`.

## 8. Из какой директории запускать

Из папки `finance-app` внутри клона репозитория:

```bash
cd ~/путь/к/Basa/finance-app
git pull
pwd   # должно заканчиваться на /finance-app
```

Если репозитория на Mac ещё нет:

```bash
cd ~ && git clone https://github.com/dmitriykononenko-lang/Basa.git && cd Basa/finance-app
git checkout claude/intelligent-ramanujan-Jdbbu
```

## 9. Команда запуска

```bash
bash scripts/backup/backup_and_verify.sh
```

## 10. Что скрипт спросит или сделает интерактивно

* Ничего не спрашивает про пароль — берёт его из `PGPASSWORD`.
* После предполётной проверки печатает одну строку со счётчиками и **ждёт 10
  секунд**. Если числа разошлись с принятым baseline — нажмите **Ctrl-C**.
  Ориентир на сейчас: `tx=7970 batches=275 active_backends=0 cron=1:f,2:f`.
* Больше пауз нет, остальное идёт само.

## 11. Как выглядит успешное завершение

В конце:

```
============================================================
ВСЁ ПРОШЛО УСПЕШНО
артефакты: /Users/<вы>/basa-backup-<TS>
зашифровать дамп:  age -p -o ... && rm -P ...
============================================================
```

Если что-то пошло не так, скрипт останавливается на первом же сбое строкой
`ОСТАНОВ: ...` и возвращает ненулевой код. Полпути он не проходит.

## 12. Где окажутся артефакты

В домашней папке, каталог `~/basa-backup-<дата-время>/` (права `700`),
**вне репозитория**. Внутри: сам дамп `.dump`, `backup_metadata_*.txt`,
`SHA256SUMS`, логи `pg_dump`/`pg_restore`/миграций/отката, файлы сверки
`expected_*` / `actual_*`, `not_covered_*`, `migration_timings_*`.

## 13. Что прислать мне на проверку

Достаточно этих блоков вывода (в них нет ни пароля, ни данных):

1. строка предполётной проверки;
2. весь блок `backup_metadata` (start/end, size, sha256, версии, source с
   затёртым паролем);
3. `── состав дампа (топ типов объектов) ──`;
4. `[restore] все N показателей совпали` **или** список расхождений;
5. блок `объекты вне дампа`;
6. таблицу `migration_timings` (7 строк);
7. последние ~30 строк integrity audit;
8. блок `── откат ──` и строку про `ОТКАТ ЧИСТЫЙ` либо diff.

Проще всего сохранить весь вывод сразу:

```bash
bash scripts/backup/backup_and_verify.sh 2>&1 | tee ~/basa-verify-log.txt
```

и прислать `~/basa-verify-log.txt`. Пароля там нет — скрипт его нигде не печатает.

## 14. Убедиться, что бэкап не попал в Git

```bash
cd ~/путь/к/Basa
git status --porcelain
```

Вывод должен быть пустым либо не содержать `.dump`, `basa-backup-*`,
`cron_jobs_*`. Дополнительная проверка:

```bash
git check-ignore -v ../basa-backup-*/*.dump 2>/dev/null; echo "---"; git ls-files | grep -i '\.dump$' ; echo "(пусто = в Git ничего не попало)"
```

Каталог с бэкапом лежит в домашней папке, а не в репозитории, поэтому попасть в
коммит он в принципе не может.

## 15. Убрать пароль из окружения после проверки

```bash
unset PGPASSWORD DB_URL
```

Если пользовались `~/.pgpass` — удалите строку:

```bash
cp ~/.pgpass ~/.pgpass.bak && grep -v 'postgres.kmvsjozxjosmkhvphzdz' ~/.pgpass.bak > ~/.pgpass && rm ~/.pgpass.bak
```

И зашифруйте дамп, а открытый файл удалите:

```bash
brew install age
cd ~/basa-backup-*/
age -p -o basa_public_*.dump.age basa_public_*.dump && rm -P basa_public_*.dump
```

Парольную фразу сохраните в менеджере паролей — без неё дамп не открыть.

---

## Если что-то пошло не так

| Сообщение | Что делать |
|---|---|
| `не найден pg_dump версии 17+` | повторите `export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"` |
| `в DB_URL вписан пароль` | уберите `:пароль` из `DB_URL`, пароль только через `PGPASSWORD` |
| `нужен PGPASSWORD` | выполните команду `read -rsp ...` из шага 7 в этом же окне |
| `connection ... timed out` | взяли Direct connection вместо Session pooler — вернитесь к шагам 5–7 |
| `pg_dump: error: server version mismatch` | стоит старый клиент, см. шаг 3 |
| `initdb: cannot be run as root` | не запускайте через `sudo` |
| `запускайте из репозитория` | вы не в папке `finance-app`, см. шаг 8 |

Скрипт ничего не удаляет и не меняет в production. Любой сбой — это остановка,
а не частично выполненная операция.

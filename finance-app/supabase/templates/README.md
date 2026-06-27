# Письма авторизации (Supabase Auth) — настройка и брендовые шаблоны

Зачем: встроенный почтовый сервис Supabase (`noreply@mail.app.supabase.io`) жёстко лимитирован и
шлёт с чужого домена без вашего SPF/DKIM → письма при регистрации не доходят / попадают в спам.
Решение — собственный SMTP (**Resend**) + брендовые шаблоны из этой папки.

Эти HTML-файлы — **источник правды**. Сами настройки SMTP/URL/шаблонов задаются **только в
дашборде Supabase** (через API/MCP это сделать нельзя), поэтому содержимое файлов нужно вставить
в дашборд вручную.

## Шаг 0. Домен (обязателен для реальных писем)

Без своего домена Resend шлёт только на ваш собственный адрес (тестовый режим). Купите дешёвый
домен (можно в Vercel → Domains) и отправляйте с `noreply@<домен>`. Поддомен `mail.<домен>` тоже
подойдёт.

## Шаг 1. Resend

1. Зарегистрируйтесь на resend.com.
2. **Domains → Add Domain** → добавьте DNS-записи (SPF/DKIM, опц. DMARC), дождитесь **Verified**.
3. Получите SMTP-доступ:
   - Host `smtp.resend.com`, Port `465` (SSL) или `587` (TLS)
   - User `resend`
   - Password — API-ключ `re_...` (секрет, **в репозиторий не коммитим**).

## Шаг 2. Supabase → Authentication → SMTP Settings → Enable Custom SMTP

- Sender email: `noreply@<домен>` · Sender name: `Basa Finance`
- Host `smtp.resend.com`, Port `465`, User `resend`, Password = `re_...`
- (Опц.) Rate Limits → поднять «emails per hour».

## Шаг 3. Supabase → Authentication → URL Configuration

- **Site URL:** `https://basa-16bf.vercel.app`
- **Redirect URLs:**
  - `https://basa-16bf.vercel.app/**`
  - `https://*-dmitriykononenko-langs-projects.vercel.app/**`
  - (позже) `https://<кастомный-домен>/**`

## Шаг 4. Supabase → Authentication → Email Templates

Вставьте HTML из файлов в соответствующие шаблоны (Source/HTML-режим редактора):

| Файл | Шаблон | Тема письма (Subject) |
|---|---|---|
| `confirmation.html` | Confirm signup | Подтвердите почту — Basa Finance |
| `invite.html` | Invite user | Приглашение в команду — Basa Finance |
| `magic_link.html` | Magic Link | Ссылка для входа — Basa Finance |
| `recovery.html` | Reset Password | Сброс пароля — Basa Finance |
| `email_change.html` | Change Email Address | Подтвердите смену почты — Basa Finance |

Плейсхолдеры Supabase (Go-шаблоны) не трогать: `{{ .ConfirmationURL }}`, `{{ .NewEmail }}`.

## Проверка

1. Зарегистрируйте тестового пользователя на `https://basa-16bf.vercel.app/login`.
2. Письмо должно прийти во «Входящие» от `noreply@<домен>` с брендовой вёрсткой.
3. В Supabase → Logs → Auth у события `mail.send` поле `mail_from` = ваш домен (не `supabase.io`).
4. Кнопка в письме → `/auth/callback` → редирект на `/dashboard`.
5. Прогоните письмо через mail-tester.com (цель ≥ 9/10; SPF и DKIM = pass).

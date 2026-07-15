# 👀 Глаз Босса — Руководство разработчика

## Быстрый старт

### 1. Установить виджет в amoCRM

1. Упакуйте виджет в ZIP:
```bash
zip -r boss-eye.zip manifest.json widget.js css/ i18n/ images/ monitoring.js
```

2. Загрузите в **Настройки → Интеграции → Виджеты**

3. В настройках виджета укажите:
   - **URL сервера:** адрес вашего бэкенда
   - Включите опции мониторинга

### 2. Запустить бэкенд

```bash
cd server

# Скопируйте конфиг
cp .env.example .env

# Установите Telegram
# TELEGRAM_BOT_TOKEN=123:ABCD  (от @BotFather)
# TELEGRAM_CHAT_ID=987654321   (ваш ID чата)

# Установите зависимости
composer install

# Запустите сервер
php -S 0.0.0.0:8080 -t public
```

### 3. Настроить webhooks в amoCRM

В **Интеграции → Webhook** добавьте:

| Событие | URL | Метод |
|--------|-----|-------|
| Leads (created, updated, status_changed) | `https://вашсервер.com/webhook/events/leads` | POST |
| Notes (added) | `https://вашсервер.com/webhook/events/notes` | POST |
| Tasks (added, completed) | `https://вашсервер.com/webhook/events/tasks` | POST |

---

## 📊 Архитектура

### Поток обработки событий

```
amoCRM Webhook
    ↓
WebhookEventController
    ↓
ActivityLogger (логирование)
    ↓
ViolationMonitor (детекция нарушений)
    ↓
ViolationStorage (сохранение)
    ↓
TelegramNotificationService (отправка уведомлений)
    ↓
Telegram Bot
```

### Компоненты

#### 1. ActivityLogger
**Файл:** `server/src/Monitor/ActivityLogger.php`

Логирует все действия менеджеров:
- Lead movements (переходы по этапам)
- Notes (комментарии)
- Tasks (задачи)

**Хранилище:** `storage/activities/{account_id}_activities.json`

**API:**
```php
$logger->log($accountId, [
    'manager_id' => 123,
    'lead_id' => 456,
    'event_type' => 'note_added',
    'details' => [...]
]);

$activities = $logger->getActivities($accountId, [
    'manager_id' => 123,
    'since' => '2024-07-15'
]);

$lastActivity = $logger->getLastActivity($accountId, 123);
```

#### 2. ViolationMonitor
**Файл:** `server/src/Monitor/ViolationMonitor.php`

Детектирует нарушения по правилам:

```php
// Проверка задержки ответа
$monitor->checkForResponseTimeViolation($accountId, $leadId);

// Проверка бездействия
$violation = $monitor->checkForInactivity($accountId, $managerId, 60); // 60 минут

// Создание нарушения
$monitor->createViolation($accountId, [
    'type' => 'slow_answer',
    'manager_id' => 123,
    'lead_id' => 456,
    'message' => 'Клиент ждёт ответ 25 минут'
]);
```

#### 3. ViolationStorage
**Файл:** `server/src/Monitor/ViolationStorage.php`

Хранилище нарушений в JSON.

**Хранилище:** `storage/violations/{account_id}_violations.json`

#### 4. TelegramNotificationService
**Файл:** `server/src/Monitor/TelegramNotificationService.php`

Отправляет сообщения в Telegram с кнопками действий.

```php
$telegram->sendViolationNotification($violation, $amoCrmBaseUrl);
```

---

## 🔗 API Endpoints

### Violations API

#### `POST /api/violations` - Создать нарушение

```bash
curl -X POST http://localhost:8080/api/violations \
  -H "X-Account-Id: 12345" \
  -H "Content-Type: application/json" \
  -d '{
    "manager_id": 123,
    "manager_name": "Иван Иванов",
    "lead_id": 456,
    "lead_title": "Оптовая поставка",
    "type": "slow_answer",
    "message": "Клиент ждёт ответ 25 минут"
  }'
```

**Response:**
```json
{
  "status": "ok",
  "violation": {
    "id": "v_abc123",
    "type": "slow_answer",
    "status": "new",
    "created_at": "2024-07-15T10:30:00+00:00"
  }
}
```

#### `GET /api/violations` - Получить нарушения

**Query параметры:**
- `status`: `new`, `sent_to_telegram`, `resolved`
- `manager_id`: ID менеджера

```bash
curl http://localhost:8080/api/violations?status=new&manager_id=123 \
  -H "X-Account-Id: 12345"
```

**Response:**
```json
{
  "status": "ok",
  "violations": [
    {
      "id": "v_abc123",
      "manager_id": 123,
      "lead_id": 456,
      "type": "slow_answer",
      "status": "new",
      "created_at": "2024-07-15T10:30:00+00:00"
    }
  ]
}
```

#### `PUT /api/violations/{id}` - Разрешить нарушение

```bash
curl -X PUT http://localhost:8080/api/violations/v_abc123 \
  -H "X-Account-Id: 12345" \
  -H "Content-Type: application/json" \
  -d '{"action": "forgive"}'
```

**Action:**
- `forgive` - Помиловать (отменить наказание)
- `punish` - Казнить (применить штраф)

---

### Activities API

#### `GET /api/activities` - Список активностей

**Query параметры:**
- `manager_id`: фильтр по менеджеру
- `lead_id`: фильтр по сделке
- `event_type`: тип события (`lead_moved`, `note_added`, `task_event`)
- `since`: начиная с даты (ISO 8601)

```bash
curl "http://localhost:8080/api/activities?manager_id=123&since=2024-07-15" \
  -H "X-Account-Id: 12345"
```

**Response:**
```json
{
  "status": "ok",
  "activities": [
    {
      "id": "act_xyz789",
      "manager_id": 123,
      "lead_id": 456,
      "event_type": "note_added",
      "details": {
        "note_text": "Клиент согласился с ценой",
        "is_manager": false
      },
      "created_at": "2024-07-15T10:30:00+00:00"
    }
  ]
}
```

#### `GET /api/activities/lead/{lead_id}` - История сделки

```bash
curl http://localhost:8080/api/activities/lead/456 \
  -H "X-Account-Id: 12345"
```

#### `GET /api/activities/manager/{manager_id}/stats` - Статистика менеджера

```bash
curl http://localhost:8080/api/activities/manager/123/stats \
  -H "X-Account-Id: 12345"
```

**Response:**
```json
{
  "status": "ok",
  "stats": {
    "manager_id": 123,
    "total_activities": 42,
    "activities_by_type": {
      "lead_moved": 12,
      "note_added": 25,
      "task_event": 5
    },
    "activity_today": 8,
    "last_activity": {
      "event_type": "note_added",
      "created_at": "2024-07-15T15:45:00+00:00"
    }
  }
}
```

---

## 🎯 Типы нарушений

### Доступные типы

| Тип | Код | Триггер | Severity |
|-----|-----|---------|----------|
| Задержка ответа | `slow_answer` | Коммент клиента без ответа > 15 мин | ⚠️ Medium |
| Бездействие | `idle` | Нет активности > 60 мин | ⚠️ Medium |
| Задержка КП | `delay_kp` | Custom field "КП обещана" прошла | 🔴 High |
| Пропущенная задача | `task_missed` | Deadline + не выполнено > 1 часа | 🔴 High |
| Неполная карточка | `incomplete_card` | Отсутствуют обязательные поля | 🔴 High |

---

## 🔔 Telegram интеграция

### Получение данных бота

1. Откройте @BotFather в Telegram
2. `/newbot` - создайте нового бота
3. Скопируйте token: `123456:ABCDefghijklmnop`

### Получение ID чата

1. Отправьте любое сообщение боту
2. Откройте URL: `https://api.telegram.org/bot123456:ABCDefghijklmnop/getUpdates`
3. Найдите `"chat":{"id":123456789}`

### Пример сообщения

```
🚨 ГЛАЗ БОССА

Нарушение: Задержка ответа клиенту
Сделка: #30214 «Оптовая поставка кабеля»
Ответственный: Мария Соколова
Время: 17:07, 15.07.2026

Клиент ждёт ответ 25 минут

[✓ ПОМИЛОВАТЬ] [✗ КАЗНИТЬ] [🔍 ПОСМОТРЕТЬ]
```

---

## 💾 Структура хранилища

```
storage/
├── violations/
│   └── {account_id}_violations.json
│       └── {
│           "v_xxx": {
│             "id": "v_xxx",
│             "account_id": "12345",
│             "manager_id": 123,
│             "lead_id": 456,
│             "type": "slow_answer",
│             "message": "...",
│             "status": "new",
│             "created_at": "2024-07-15T10:30:00+00:00"
│           }
│         }
│
├── activities/
│   └── {account_id}_activities.json
│       └── {
│           "act_xxx": {
│             "id": "act_xxx",
│             "manager_id": 123,
│             "lead_id": 456,
│             "event_type": "note_added",
│             "details": {...},
│             "created_at": "2024-07-15T10:30:00+00:00"
│           }
│         }
│
└── schedules/
    └── {account_id}/
        └── {manager_id}.json
```

---

## 🧪 Тестирование

### Создать тестовое нарушение

```bash
curl -X POST http://localhost:8080/api/violations \
  -H "X-Account-Id: test_account" \
  -H "Content-Type: application/json" \
  -d '{
    "manager_id": 1,
    "manager_name": "Test Manager",
    "lead_id": 100,
    "lead_title": "Test Deal",
    "type": "slow_answer",
    "message": "Test violation"
  }'
```

### Проверить нарушения

```bash
curl "http://localhost:8080/api/violations" \
  -H "X-Account-Id: test_account"
```

### Создать логирование активности

```bash
# Используйте WebhookEventController или прямой вызов
# В реальности это приходит от amoCRM webhooks
```

---

## 📝 Интеграция с амоCRM

### Настройка webhooks в UI

1. **Настройки → Интеграции → Webhook**
2. **Добавить webhook** для каждого события:

**Event: Leads**
```
Условия:
- Статус сделки изменён
- Сделка создана

URL: https://example.com/webhook/events/leads
```

**Event: Notes**
```
Условие: Комментарий добавлен

URL: https://example.com/webhook/events/notes
```

**Event: Tasks**
```
Условие: Задача создана/завершена

URL: https://example.com/webhook/events/tasks
```

---

## 🐛 Отладка

### Логирование

Все события логируются в stderr (Phil stderr):

```bash
# Смотреть логи в реальном времени
tail -f storage/logs/app.log

# Установить уровень логирования в .env
LOG_LEVEL=DEBUG
```

### Проверка структуры

```bash
# Проверить JSON файлы хранилища
cat storage/violations/test_account_violations.json | jq
cat storage/activities/test_account_activities.json | jq
```

---

## 🔐 Безопасность

### Проверка токенов

- **X-Account-Id**: проверяется для всех запросов
- **X-Telegram-Bot-Api-Secret-Token**: проверяется для Telegram webhooks
- CORS headers: настроены для защиты от CSRF

---

## 📈 Производительность

### Оптимизация

- Активности хранятся в JSON (max 1000 на аккаунт)
- Для большого объема данных рекомендуется миграция на БД
- Кешированием менеджеров для снижения вызовов к API

### Миграция на БД

Для масштабирования создайте:

```sql
CREATE TABLE activities (
  id VARCHAR(50) PRIMARY KEY,
  account_id VARCHAR(50),
  manager_id INT,
  lead_id INT,
  event_type VARCHAR(50),
  details JSON,
  created_at TIMESTAMP,
  INDEX idx_manager_created (manager_id, created_at)
);

CREATE TABLE violations (
  id VARCHAR(50) PRIMARY KEY,
  account_id VARCHAR(50),
  manager_id INT,
  lead_id INT,
  type VARCHAR(50),
  severity VARCHAR(20),
  message TEXT,
  status VARCHAR(20),
  created_at TIMESTAMP,
  INDEX idx_status (status, account_id)
);
```

---

## 🚀 Развертывание

### Production setup

```bash
# Используйте Nginx/Apache в front
# PHP-FPM для обработки запросов
# Регулярная ротация логов
# Резервное копирование storage/

# systemd service файл:
[Unit]
Description=Boss's Eye API Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/app/server
ExecStart=/usr/bin/php -S 0.0.0.0:8080 -t public
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

---

## 📞 Поддержка

Если у вас возникли проблемы:

1. Проверьте логи: `LOG_LEVEL=DEBUG`
2. Убедитесь, что webhooks настроены в амоCRM
3. Проверьте Telegram токены в .env
4. Используйте Postman для тестирования API

---

**Версия:** 2.0.0 (Phase 2)
**Обновлено:** July 2024
**Статус:** In Development

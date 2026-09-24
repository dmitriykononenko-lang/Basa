import { NextResponse } from "next/server";

// Управляемая техническая заморозка банковского импорта на время окна
// «backup → миграции». Переключается переменной окружения
// FINANCIAL_IMPORTS_DISABLED и проверяется на сервере — первым действием в
// каждом write/import-маршруте, до обращения к API Точки, до создания
// import_batches, до сдвига bank_connections.last_synced_at и до любой записи
// в transactions.
//
// Клиентский триггер TochkaAutoSync при этом можно не трогать: он продолжит
// звать /api/tochka/auto-sync, получит 503 и молча его проглотит
// (`r.ok ? r.json() : null`) — интерфейс не сломается, а записи не произойдёт.
//
// Семантика намеренно fail-closed в сторону «заблокировано»: разблокировать
// может только явное false/0/no/off, а любое другое значение (в том числе
// опечатка вроде "ture") означает заморозку. Опечатка не должна тихо открывать
// импорт. Если переменной нет вовсе — решает LOCK_DEFAULT ниже.

// Состояние по умолчанию, когда переменная окружения НЕ задана.
// Сейчас true: у интеграции Vercel нет права создавать production env vars
// (API отвечает 403 «Additional permissions are required to create production
// environment variables»), поэтому замок держится самим кодом, а не переменной.
// Благодаря этому заморозка переживает и деплой PR #99 — в его ветке лежит этот
// же модуль. Снятие замка — отдельный коммит (LOCK_DEFAULT = false) и отдельный
// деплой, то есть осознанный контролируемый шаг, а не побочный эффект.
const LOCK_DEFAULT = true;

const OFF = new Set(["false", "0", "no", "off"]);

export function financialImportsLocked(): boolean {
  const raw = (process.env.FINANCIAL_IMPORTS_DISABLED ?? "").trim().toLowerCase();
  if (raw === "") return LOCK_DEFAULT;   // переменной нет — решает код
  if (OFF.has(raw)) return false;        // явное выключение
  return true;                           // true/1/yes/on и любое иное значение
}

export function financialImportsLockedResponse() {
  return NextResponse.json(
    {
      ok: false,
      locked: true,
      error: "Импорт банковских операций временно приостановлен на время технических работ",
    },
    { status: 503, headers: { "Retry-After": "3600", "Cache-Control": "no-store" } },
  );
}

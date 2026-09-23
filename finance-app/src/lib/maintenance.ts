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
// Семантика намеренно fail-closed в сторону «заблокировано»: пустая или
// отсутствующая переменная означает обычный режим, явные false/0/no/off —
// тоже обычный режим, а любое другое значение (в том числе опечатка вроде
// "ture") трактуется как заморозка. Опечатка не должна тихо открывать импорт.

const OFF = new Set(["false", "0", "no", "off"]);

export function financialImportsLocked(): boolean {
  const raw = (process.env.FINANCIAL_IMPORTS_DISABLED ?? "").trim().toLowerCase();
  if (raw === "") return false;
  return !OFF.has(raw);
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

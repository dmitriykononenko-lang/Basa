"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";

// Явный запуск авто-начислений. Кнопка заменила скрытую запись при рендере
// страницы: GET /payroll теперь строго read-only (аудит, T1).
export default function MaterializeAccrualsButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch("/api/payroll/materialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; accruals?: number; cycles?: number };
      if (!res.ok || !j.ok) {
        toast.error(j.error ?? "Не удалось обновить начисления");
        return;
      }
      const n = (j.accruals ?? 0) + (j.cycles ?? 0);
      toast.success(n > 0 ? `Досоздано начислений: ${n}` : "Всё уже начислено");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={run}
      disabled={busy}
      title="Досоздать автоматические начисления (зарплата в авто-режиме, циклы поддержки)"
      className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/[0.06]"
    >
      {busy ? "Обновляю…" : "Обновить начисления"}
    </button>
  );
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Тихий фоновый триггер авто-синка Точки при открытии приложения. Ничего не рисует.
// Тротлинг на вкладку — раз в 30 мин; сервер дополнительно не чаще раза в 2 часа.
export default function TochkaAutoSync() {
  const router = useRouter();
  useEffect(() => {
    try {
      const key = "tochka_autosync_ts";
      const last = Number(sessionStorage.getItem(key) || 0);
      if (Date.now() - last < 30 * 60 * 1000) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch { /* приватный режим — просто продолжаем */ }

    let cancelled = false;
    fetch("/api/tochka/auto-sync", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j && typeof j.imported === "number" && j.imported > 0) router.refresh(); })
      .catch(() => { /* фоновый — ошибки глушим */ });
    return () => { cancelled = true; };
  }, [router]);

  return null;
}

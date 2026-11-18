"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";

type Linked = { name: string | null; username: string | null } | null;

export default function ProfileTelegram({
  userId,
  initialLinked,
  botConfigured,
}: {
  userId: string;
  initialLinked: Linked;
  botConfigured: boolean;
}) {
  const [linked, setLinked] = useState<Linked>(initialLinked);
  const [code, setCode] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [ttl, setTtl] = useState<number>(15);
  const [busy, setBusy] = useState(false);

  async function genCode() {
    setBusy(true);
    try {
      const res = await fetch("/api/profile/telegram-code", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error("Не удалось сгенерировать код");
        return;
      }
      setCode(data.code);
      setEmail(data.email);
      setTtl(data.ttlMinutes ?? 15);
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    if (!confirm("Отвязать Telegram-аккаунт?")) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("telegram_links").delete().eq("user_id", userId);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setLinked(null);
    toast.success("Telegram отвязан");
  }

  return (
    <div className="surface rounded-3xl p-6">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-neutral-100">Telegram</h2>
        {linked && (
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
            привязан
          </span>
        )}
      </div>

      {linked ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-sm text-slate-600 dark:text-neutral-300">
            {linked.name || (linked.username ? `@${linked.username}` : "Аккаунт привязан")}
            <span className="block text-xs text-slate-400">
              Обучение доступно в Telegram Mini App.
            </span>
          </p>
          <button type="button" onClick={unlink} disabled={busy} className="btn-ghost text-sm">
            Отвязать
          </button>
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            Привяжите Telegram, чтобы проходить обучение в мини-приложении бота.
          </p>

          {!botConfigured && (
            <p className="mt-2 rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
              Бот ещё не настроен администратором (нет TELEGRAM_BOT_TOKEN). Привязка заработает после настройки.
            </p>
          )}

          {code ? (
            <div className="mt-3 rounded-2xl border border-slate-200 p-4 dark:border-white/10">
              <p className="text-xs text-slate-500 dark:text-neutral-400">Ваш код привязки (действует {ttl} мин):</p>
              <div className="mt-1 font-mono text-2xl font-bold tracking-[0.3em] text-brand">{code}</div>
              <ol className="mt-3 list-decimal space-y-1 pl-4 text-xs text-slate-500 dark:text-neutral-400">
                <li>Откройте бота в Telegram и запустите Mini App «Обучение».</li>
                <li>Введите ваш email <span className="font-medium text-slate-700 dark:text-neutral-200">{email}</span> и этот код.</li>
              </ol>
              <button type="button" onClick={genCode} disabled={busy} className="btn-ghost mt-3 text-xs">
                Сгенерировать новый код
              </button>
            </div>
          ) : (
            <button type="button" onClick={genCode} disabled={busy} className="btn-primary mt-3 text-sm">
              {busy ? "…" : "Привязать Telegram"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

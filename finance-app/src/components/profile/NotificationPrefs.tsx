"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";

export default function NotificationPrefs({
  userId,
  teamId,
  initialEnabled,
  emailReady,
}: {
  userId: string;
  teamId: string;
  initialEnabled: boolean;
  emailReady: boolean;
}) {
  const supabase = useRef(createClient()).current;
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setBusy(true);
    const { error } = await supabase
      .from("notification_prefs")
      .upsert({ team_id: teamId, user_id: userId, email_digest: next }, { onConflict: "team_id,user_id" });
    setBusy(false);
    if (error) {
      setEnabled(!next);
      toast.error(error.message);
      return;
    }
    toast.success(next ? "Email-дайджест включён" : "Email-дайджест выключен");
  }

  return (
    <div className="surface rounded-3xl p-6">
      <h2 className="text-sm font-semibold text-slate-800 dark:text-neutral-100">Уведомления</h2>
      <p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">
        Колокольчик в шапке работает всегда. Email-дайджест присылает сводку важных событий раз в день.
      </p>

      {!emailReady && (
        <div className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-900/40">
          Отправка писем пока не настроена администратором (нет ключа Resend). Настройку можно сохранить — письма
          начнут приходить, как только email подключат.
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-slate-800 dark:text-neutral-200">Email-дайджест</div>
          <div className="text-xs text-slate-400 dark:text-neutral-500">Ежедневная сводка: кассовые разрывы, просрочки, дедлайны обучения.</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={toggle}
          disabled={busy}
          className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
            enabled ? "bg-brand" : "bg-slate-300 dark:bg-neutral-700"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
              enabled ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
      </div>
    </div>
  );
}

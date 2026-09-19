"use client";

import { useState } from "react";

function Copy({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="btn-ghost shrink-0 text-xs"
      onClick={async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); } catch {} }}>
      {ok ? "Скопировано ✓" : "Копировать"}
    </button>
  );
}

export default function ObsidianSettings({
  manage, connected, lastSyncedAt, baseUrl,
}: {
  manage: boolean;
  connected: boolean;
  lastSyncedAt: string | null;
  baseUrl: string;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (connected && !confirm("Перевыпустить токен? Старый перестанет работать — плагин нужно будет обновить.")) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/obsidian/token", { method: "POST" });
      const d = await r.json();
      if (!r.ok || !d.ok) { setError(d.error ?? "Не удалось создать токен"); return; }
      setToken(d.token);
    } catch { setError("Сеть недоступна"); } finally { setBusy(false); }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <section className="surface rounded-3xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">
              Статус: {connected ? "подключено" : "не подключено"}
            </div>
            <div className="mt-0.5 text-xs text-slate-400 dark:text-neutral-500">
              {lastSyncedAt ? `Последняя синхронизация: ${lastSyncedAt}` : "Синхронизаций ещё не было"}
            </div>
          </div>
          {manage && (
            <button type="button" className="btn-primary" disabled={busy} onClick={generate}>
              {busy ? "…" : connected ? "Перевыпустить токен" : "Сгенерировать токен"}
            </button>
          )}
        </div>

        {token && (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/25 dark:bg-emerald-500/10">
            <div className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Токен создан — скопируйте сейчас</div>
            <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-300/70">Токен показывается один раз. Вставьте его в настройках плагина в Obsidian.</p>
            <div className="mt-2 flex items-center gap-2">
              <input readOnly value={token} onFocus={(e) => e.currentTarget.select()} className="input font-mono text-xs" />
              <Copy text={token} />
            </div>
          </div>
        )}
        {error && <p className="mt-3 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      </section>

      <section className="surface rounded-3xl p-5">
        <h2 className="mb-2 text-sm font-bold text-slate-900 dark:text-white">Как подключить Obsidian</h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-600 dark:text-neutral-300">
          <li>Сгенерируйте токен выше и скопируйте его.</li>
          <li>Установите плагин <b>Basa Sync</b>: папку <code>basa-sync</code> из репозитория (<code>obsidian-plugin/</code>) положите в <code>&lt;хранилище&gt;/.obsidian/plugins/</code> и включите плагин в настройках Obsidian.</li>
          <li>В настройках плагина укажите:
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xs text-slate-400">URL:</span>
              <input readOnly value={baseUrl} onFocus={(e) => e.currentTarget.select()} className="input h-8 font-mono text-xs" /><Copy text={baseUrl} />
            </div>
            <div className="mt-1 text-xs text-slate-400">и вставьте токен.</div>
          </li>
          <li>Команды плагина: «Pull from Basa» (статьи → файлы) и «Push to Basa» (файлы → статьи). Правки синхронизируются по <code>updated_at</code>; при конфликте создаётся <code>*.conflict.md</code>.</li>
        </ol>
        <p className="mt-3 text-[11px] text-slate-400 dark:text-neutral-600">
          Технически: <code>GET {baseUrl}/api/obsidian/pull</code> и <code>POST {baseUrl}/api/obsidian/push</code> с заголовком <code>Authorization: Bearer &lt;токен&gt;</code>.
        </p>
      </section>
    </div>
  );
}

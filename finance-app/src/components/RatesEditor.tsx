"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { RateMap } from "@/lib/fx";

export default function RatesEditor({
  teamId,
  baseCurrency,
  currencies,
  rates,
}: {
  teamId: string;
  baseCurrency: string;
  currencies: string[];
  rates: RateMap;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      currencies.map((c) => [c, rates[c] !== undefined ? String(rates[c]) : ""])
    )
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [cbrBusy, setCbrBusy] = useState(false);
  const [cbrDate, setCbrDate] = useState<string | null>(null);

  if (currencies.length === 0) return null;

  // Подтянуть курсы ЦБ на сегодня и подставить в поля (USDT ЦБ приравнивает к USD).
  async function loadCbr() {
    setCbrBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/cbr", { cache: "no-store" });
      const json = (await res.json()) as { date?: string; rates?: Record<string, number>; error?: string };
      if (!res.ok || !json.rates) {
        setError(json.error ?? "Не удалось получить курсы ЦБ");
        return;
      }
      setValues((v) => {
        const next = { ...v };
        for (const c of currencies) {
          const r = json.rates![c] ?? json.rates![c.toUpperCase()];
          if (r) next[c] = String(Math.round(r * 10000) / 10000).replace(".", ",");
        }
        return next;
      });
      if (json.date) setCbrDate(json.date.slice(0, 10));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось получить курсы ЦБ");
    } finally {
      setCbrBusy(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const supabase = createClient();
    const today = new Date().toISOString().slice(0, 10);

    const rows = currencies
      .map((c) => ({ currency: c, rate: parseFloat(values[c]?.replace(",", ".") ?? "") }))
      .filter((r) => !isNaN(r.rate) && r.rate > 0)
      .map((r) => ({
        team_id: teamId,
        currency: r.currency,
        rate: r.rate,
        rate_date: today,
      }));

    if (rows.length === 0) {
      setError("Введите хотя бы один курс");
      setSaving(false);
      return;
    }

    const { error } = await supabase
      .from("fx_rates")
      .upsert(rows, { onConflict: "team_id,currency,rate_date" });

    if (error) {
      setError(error.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <h2 className="mb-1 text-sm font-semibold text-slate-800 dark:text-neutral-200">
        Курсы валют
      </h2>
      <p className="mb-3 text-xs text-slate-400 dark:text-neutral-500">
        Сколько {baseCurrency} стоит 1 единица валюты. Используется для пересчёта
        сводок в основную валюту.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={loadCbr}
          disabled={cbrBusy}
          className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 disabled:opacity-50 dark:bg-white/[0.06] dark:text-neutral-200 dark:hover:bg-white/[0.1]"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
          </svg>
          {cbrBusy ? "Загрузка…" : "Курс ЦБ на сегодня"}
        </button>
        {cbrDate && (
          <span className="text-xs text-slate-400 dark:text-neutral-500">
            подставлен курс ЦБ на {new Date(cbrDate).toLocaleDateString("ru-RU")} — проверьте и сохраните
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {currencies.map((c) => (
          <div key={c}>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">
              1 {c} =
            </label>
            <div className="flex items-center gap-1">
              <input
                type="text"
                inputMode="decimal"
                value={values[c] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [c]: e.target.value }))
                }
                placeholder="0.00"
                className="input w-28"
              />
              <span className="text-sm text-slate-400">{baseCurrency}</span>
            </div>
          </div>
        ))}
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? "…" : "Сохранить курсы"}
        </button>
        {saved && (
          <span className="text-sm text-emerald-600 dark:text-emerald-400">
            Сохранено
          </span>
        )}
      </div>
      {error && (
        <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">
          {error}
        </p>
      )}
    </div>
  );
}

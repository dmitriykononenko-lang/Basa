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

  if (currencies.length === 0) return null;

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

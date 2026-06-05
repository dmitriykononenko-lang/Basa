"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const CURRENCIES = ["RUB", "USD", "EUR", "KZT", "UAH", "GBP", "CNY"];

export default function CreateTeamForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("RUB");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.rpc("create_team", {
      _name: name,
      _base_currency: currency,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-md space-y-4 rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200"
    >
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Создайте команду
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Это пространство, где команда ведёт финансы. Вы станете владельцем.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Название
        </label>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Моя компания"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Основная валюта
        </label>
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-400">
          Валюта для сводных отчётов. Счета могут быть в любых валютах.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
      >
        {loading ? "Создаём…" : "Создать команду"}
      </button>
    </form>
  );
}

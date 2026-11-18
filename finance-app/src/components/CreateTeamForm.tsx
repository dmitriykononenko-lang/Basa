"use client";

import { useState } from "react";
import { Select } from "@/components/ui/select";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CURRENCIES } from "@/lib/constants";

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
      className="surface w-full max-w-md space-y-4 p-8"
    >
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
          Создайте команду
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
          Это пространство, где команда ведёт финансы. Вы станете владельцем.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-neutral-300">
          Название
        </label>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Моя компания"
          className="input"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-neutral-300">
          Основная валюта
        </label>
        <Select value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        <p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">
          Валюта для сводных отчётов. Счета могут быть в любых валютах.
        </p>
      </div>

      {error && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="btn-magic w-full"
      >
        {loading ? "Создаём…" : "Создать команду"}
      </button>
    </form>
  );
}

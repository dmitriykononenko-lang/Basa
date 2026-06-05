"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CURRENCIES, ACCOUNT_KINDS } from "@/lib/constants";

export default function AddAccountForm({ teamId }: { teamId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("RUB");
  const [kind, setKind] = useState("cash");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.from("accounts").insert({
      team_id: teamId,
      name,
      currency,
      kind,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setName("");
    setOpen(false);
    setLoading(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark"
      >
        + Добавить счёт
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 ring-1 ring-slate-200"
    >
      <div className="flex-1 min-w-[180px]">
        <label className="mb-1 block text-xs font-medium text-slate-500">
          Название
        </label>
        <input
          type="text"
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Например, Расчётный счёт"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">
          Валюта
        </label>
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">
          Тип
        </label>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
        >
          {ACCOUNT_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
        >
          {loading ? "…" : "Сохранить"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100"
        >
          Отмена
        </button>
      </div>
      {error && (
        <p className="w-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}

"use client";

import { useState } from "react";
import { Select } from "@/components/ui/select";
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
      <button onClick={() => setOpen(true)} className="btn-primary">
        + Добавить счёт
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-3 rounded-3xl bg-white p-4 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]"
    >
      <div className="min-w-[180px] flex-1">
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">
          Название
        </label>
        <input
          type="text"
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Например, Расчётный счёт"
          className="input"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">
          Валюта
        </label>
        <Select value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">
          Тип
        </label>
        <Select value={kind} onChange={setKind} options={ACCOUNT_KINDS.map((k) => ({ value: k.value, label: k.label }))} />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? "…" : "Сохранить"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn-ghost"
        >
          Отмена
        </button>
      </div>
      {error && (
        <p className="w-full rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">
          {error}
        </p>
      )}
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ACCOUNT_KINDS } from "@/lib/constants";

export default function EditAccountForm({
  accountId, name: initialName, kind: initialKind,
}: {
  accountId: string;
  name: string;
  kind: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [kind, setKind] = useState(initialKind);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("accounts")
      .update({ name: name.trim(), kind })
      .eq("id", accountId);
    if (error) { setError(error.message); setLoading(false); return; }
    setOpen(false);
    setLoading(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-brand dark:hover:bg-white/[0.06]"
        title="Редактировать счёт"
        aria-label="Редактировать счёт"
      >
        ✎
      </button>
    );
  }

  return (
    <form onSubmit={save} className="mt-3 space-y-2 rounded-2xl bg-slate-50 p-3 dark:bg-white/[0.03]">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        className="input w-full py-1.5 text-sm"
        placeholder="Название"
      />
      <select value={kind} onChange={(e) => setKind(e.target.value)} className="input w-full py-1.5 text-sm">
        {ACCOUNT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
      </select>
      <p className="text-[11px] text-slate-400">Валюта счёта не меняется, чтобы не нарушить историю операций.</p>
      <div className="flex gap-2">
        <button type="submit" disabled={loading} className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
          {loading ? "…" : "Сохранить"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-full px-3 py-1.5 text-sm text-slate-500">Отмена</button>
      </div>
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}
    </form>
  );
}

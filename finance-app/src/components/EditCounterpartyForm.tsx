"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COUNTERPARTY_KINDS } from "@/lib/constants";

export type CounterpartyEdit = {
  id: string;
  name: string;
  kind: string;
  kinds: string[];
  inn: string;
  kpp: string;
  contact_person: string;
  phone: string;
  email: string;
  note: string;
  agent_id: string;
};

type Agent = { id: string; name: string };

export default function EditCounterpartyForm({ initial, agents = [] }: { initial: CounterpartyEdit; agents?: Agent[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [c, setC] = useState<CounterpartyEdit>(initial);
  const [kinds, setKinds] = useState<string[]>(initial.kinds.length ? initial.kinds : [initial.kind]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function upd(k: keyof CounterpartyEdit, v: string) {
    setC((p) => ({ ...p, [k]: v }));
  }
  function toggleKind(k: string) {
    setKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  }

  async function save() {
    if (kinds.length === 0) return setError("Выберите хотя бы один статус");
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("counterparties")
      .update({
        name: c.name,
        kind: kinds[0],
        kinds,
        inn: c.inn || null,
        kpp: c.kpp || null,
        contact_person: c.contact_person || null,
        phone: c.phone || null,
        email: c.email || null,
        note: c.note || null,
        agent_id: kinds.includes("agent") ? null : (c.agent_id || null),
      })
      .eq("id", c.id);
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    setBusy(false);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-ghost text-xs">
        Редактировать
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-2xl bg-slate-50 p-4 dark:bg-white/[0.03]">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <F label="Название"><input value={c.name} onChange={(e) => upd("name", e.target.value)} className="input" /></F>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Статусы (можно несколько)</label>
          <div className="flex flex-wrap gap-2">
            {COUNTERPARTY_KINDS.map((k) => (
              <button key={k.value} type="button" onClick={() => toggleKind(k.value)}
                className={`rounded-full px-3 py-1.5 text-sm ${kinds.includes(k.value) ? "bg-brand text-white" : "bg-slate-100 text-slate-600 dark:bg-neutral-800 dark:text-neutral-300"}`}>
                {k.label}
              </button>
            ))}
          </div>
        </div>
        <F label="ИНН"><input value={c.inn} onChange={(e) => upd("inn", e.target.value)} className="input" /></F>
        <F label="КПП"><input value={c.kpp} onChange={(e) => upd("kpp", e.target.value)} className="input" /></F>
        <F label="Контактное лицо"><input value={c.contact_person} onChange={(e) => upd("contact_person", e.target.value)} className="input" /></F>
        <F label="Телефон"><input value={c.phone} onChange={(e) => upd("phone", e.target.value)} className="input" /></F>
        <F label="Email"><input value={c.email} onChange={(e) => upd("email", e.target.value)} className="input" /></F>
        {!kinds.includes("agent") && !kinds.includes("employee") && (
          <F label="Пришёл от агента">
            <select value={c.agent_id} onChange={(e) => upd("agent_id", e.target.value)} className="input">
              <option value="">— нет —</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </F>
        )}
        <div className="sm:col-span-2"><F label="Заметка"><input value={c.note} onChange={(e) => upd("note", e.target.value)} className="input" /></F></div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className="btn-primary">{busy ? "…" : "Сохранить"}</button>
        <button onClick={() => setOpen(false)} className="btn-ghost">Отмена</button>
      </div>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">{label}</label>
      {children}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COUNTERPARTY_KINDS } from "@/lib/constants";

export type CounterpartyEdit = {
  id: string;
  name: string;
  kind: string;
  inn: string;
  kpp: string;
  contact_person: string;
  phone: string;
  email: string;
  note: string;
};

export default function EditCounterpartyForm({ initial }: { initial: CounterpartyEdit }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [c, setC] = useState<CounterpartyEdit>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function upd(k: keyof CounterpartyEdit, v: string) {
    setC((p) => ({ ...p, [k]: v }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("counterparties")
      .update({
        name: c.name,
        kind: c.kind,
        inn: c.inn || null,
        kpp: c.kpp || null,
        contact_person: c.contact_person || null,
        phone: c.phone || null,
        email: c.email || null,
        note: c.note || null,
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
        <F label="Тип">
          <select value={c.kind} onChange={(e) => upd("kind", e.target.value)} className="input">
            {COUNTERPARTY_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </F>
        <F label="ИНН"><input value={c.inn} onChange={(e) => upd("inn", e.target.value)} className="input" /></F>
        <F label="КПП"><input value={c.kpp} onChange={(e) => upd("kpp", e.target.value)} className="input" /></F>
        <F label="Контактное лицо"><input value={c.contact_person} onChange={(e) => upd("contact_person", e.target.value)} className="input" /></F>
        <F label="Телефон"><input value={c.phone} onChange={(e) => upd("phone", e.target.value)} className="input" /></F>
        <F label="Email"><input value={c.email} onChange={(e) => upd("email", e.target.value)} className="input" /></F>
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

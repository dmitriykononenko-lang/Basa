"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COUNTERPARTY_KINDS } from "@/lib/constants";

export default function AddCounterpartyForm({ teamId, defaultKind = "client" }: { teamId: string; defaultKind?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kinds, setKinds] = useState<string[]>([defaultKind]);
  const [form, setForm] = useState({
    name: "",
    inn: "",
    kpp: "",
    contact_person: "",
    phone: "",
    email: "",
    note: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function upd(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  function toggleKind(k: string) {
    setKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (kinds.length === 0) return setError("Выберите хотя бы один статус");
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.from("counterparties").insert({
      team_id: teamId,
      name: form.name,
      kind: kinds[0],
      kinds,
      inn: form.inn || null,
      kpp: form.kpp || null,
      contact_person: form.contact_person || null,
      phone: form.phone || null,
      email: form.email || null,
      note: form.note || null,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setForm({ name: "", inn: "", kpp: "", contact_person: "", phone: "", email: "", note: "" });
    setKinds([defaultKind]);
    setOpen(false);
    setLoading(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        + Добавить {defaultKind === "agent" ? "агента" : "контрагента"}
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <F label="Название">
          <input required autoFocus value={form.name} onChange={(e) => upd("name", e.target.value)} placeholder="ООО «Ромашка»" className="input" />
        </F>
        <div className="sm:col-span-2 lg:col-span-3">
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
        <F label="ИНН">
          <input value={form.inn} onChange={(e) => upd("inn", e.target.value)} placeholder="7700000000" className="input" />
        </F>
        <F label="КПП">
          <input value={form.kpp} onChange={(e) => upd("kpp", e.target.value)} placeholder="—" className="input" />
        </F>
        <F label="Контактное лицо">
          <input value={form.contact_person} onChange={(e) => upd("contact_person", e.target.value)} placeholder="Иван Иванов" className="input" />
        </F>
        <F label="Телефон">
          <input value={form.phone} onChange={(e) => upd("phone", e.target.value)} placeholder="+7…" className="input" />
        </F>
        <F label="Email">
          <input type="email" value={form.email} onChange={(e) => upd("email", e.target.value)} placeholder="info@…" className="input" />
        </F>
        <div className="sm:col-span-2">
          <F label="Заметка">
            <input value={form.note} onChange={(e) => upd("note", e.target.value)} placeholder="Необязательно" className="input" />
          </F>
        </div>
      </div>
      {error && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? "…" : "Сохранить"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Отмена</button>
      </div>
    </form>
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

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { COUNTERPARTY_KINDS } from "@/lib/constants";
import { EXTERNAL_SYSTEMS, type ExternalId } from "@/components/EditCounterpartyForm";

export default function AddCounterpartyForm({
  teamId,
  defaultKind = "client",
  projects = [],
}: {
  teamId: string;
  defaultKind?: string;
  projects?: { id: string; name: string }[];
}) {
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
  const [extIds, setExtIds] = useState<ExternalId[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function upd(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  function toggleKind(k: string) {
    setKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  }
  function updExt(i: number, k: keyof ExternalId, v: string) {
    setExtIds((prev) => prev.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  }
  function addExt() {
    setExtIds((prev) => [...prev, { system: "amocrm", external_id: "", project_id: "" }]);
  }
  function removeExt(i: number) {
    setExtIds((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (kinds.length === 0) return setError("Выберите хотя бы один статус");
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { data: created, error } = await supabase.from("counterparties").insert({
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
    }).select("id").single();

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    // Внешние ID (amoCRM/Radist/Wazzap) для автопривязки платежей
    const extRows = extIds
      .filter((r) => r.external_id.trim())
      .map((r) => ({
        team_id: teamId,
        counterparty_id: created!.id,
        system: r.system,
        external_id: r.external_id.trim(),
        project_id: r.project_id || null,
      }));
    if (extRows.length) {
      const { error: eErr } = await supabase.from("counterparty_external_ids").insert(extRows);
      if (eErr) {
        setError(eErr.message);
        setLoading(false);
        return;
      }
    }
    setForm({ name: "", inn: "", kpp: "", contact_person: "", phone: "", email: "", note: "" });
    setExtIds([]);
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
        <div className="sm:col-span-2 lg:col-span-3">
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Внешние ID (для автопривязки платежей)</label>
          <div className="space-y-2">
            {extIds.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <div className="w-28"><Select value={r.system} onChange={(v) => updExt(i, "system", v)} options={EXTERNAL_SYSTEMS.map((s) => ({ value: s.value, label: s.label }))} /></div>
                <input value={r.external_id} onChange={(e) => updExt(i, "external_id", e.target.value)} placeholder="ID аккаунта" className="input min-w-[120px] flex-1" />
                <div className="min-w-[160px] flex-1"><Select value={r.project_id} onChange={(v) => updExt(i, "project_id", v)} placeholder="— проект (опц.) —" options={[{ value: "", label: "— проект (опц.) —" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} /></div>
                <button type="button" onClick={() => removeExt(i)} className="btn-ghost text-xs" title="Удалить">✕</button>
              </div>
            ))}
            <button type="button" onClick={addExt} className="btn-ghost text-xs">+ Добавить ID</button>
          </div>
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

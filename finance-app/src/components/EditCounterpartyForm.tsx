"use client";

import { useState } from "react";
import { Select } from "@/components/ui/select";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COUNTERPARTY_KINDS } from "@/lib/constants";
import DeleteCounterpartyButton from "@/components/DeleteCounterpartyButton";
import PaymentFields, { type PaymentData } from "@/components/PaymentFields";

export type CounterpartyEdit = {
  id: string;
  team_id: string;
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
  contract_number: string;
  contract_date: string;
  // Платёжные реквизиты (₽-банк / крипто)
  payment_method: string;
  legal_status: string;
  payee_name: string;
  bank_account: string;
  bank_name: string;
  bik: string;
  wallet_address: string;
  wallet_network: string;
};

type Agent = { id: string; name: string };
type ProjectOpt = { id: string; name: string };
export type ExternalId = { system: string; external_id: string; project_id: string };

export const EXTERNAL_SYSTEMS = [
  { value: "amocrm", label: "amoCRM" },
  { value: "radist", label: "Radist" },
  { value: "wazzap", label: "Wazzap" },
  { value: "other", label: "Другое" },
];

export default function EditCounterpartyForm({
  initial,
  agents = [],
  projects = [],
  externalIds = [],
}: {
  initial: CounterpartyEdit;
  agents?: Agent[];
  projects?: ProjectOpt[];
  externalIds?: ExternalId[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [c, setC] = useState<CounterpartyEdit>(initial);
  const [kinds, setKinds] = useState<string[]>(initial.kinds.length ? initial.kinds : [initial.kind]);
  const [extIds, setExtIds] = useState<ExternalId[]>(externalIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function upd(k: keyof CounterpartyEdit, v: string) {
    setC((p) => ({ ...p, [k]: v }));
  }
  // Платёжные реквизиты — общий компонент PaymentFields (ИНН — та же колонка, что выше).
  const pay: PaymentData = {
    payment_method: c.payment_method || "bank",
    legal_status: c.legal_status,
    payee_name: c.payee_name,
    inn: c.inn,
    bank_account: c.bank_account,
    bank_name: c.bank_name,
    bik: c.bik,
    wallet_address: c.wallet_address,
    wallet_network: c.wallet_network || "TRC20",
  };
  function setPay(v: PaymentData) {
    setC((p) => ({
      ...p,
      payment_method: v.payment_method,
      legal_status: v.legal_status,
      payee_name: v.payee_name,
      inn: v.inn,
      bank_account: v.bank_account,
      bank_name: v.bank_name,
      bik: v.bik,
      wallet_address: v.wallet_address,
      wallet_network: v.wallet_network,
    }));
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
        contract_number: c.contract_number || null,
        contract_date: c.contract_date || null,
        payment_method: c.payment_method || "bank",
        legal_status: c.legal_status || null,
        payee_name: c.payee_name || null,
        bank_account: c.bank_account || null,
        bank_name: c.bank_name || null,
        bik: c.bik || null,
        wallet_address: c.wallet_address || null,
        wallet_network: c.wallet_network || null,
      })
      .eq("id", c.id);
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    // Синхронизация внешних ID (amoCRM/Radist/Wazzap): пересоздаём набор по контрагенту.
    await supabase.from("counterparty_external_ids").delete().eq("counterparty_id", c.id);
    const rows = extIds
      .filter((r) => r.external_id.trim())
      .map((r) => ({
        team_id: initial.team_id,
        counterparty_id: c.id,
        system: r.system,
        external_id: r.external_id.trim(),
        project_id: r.project_id || null,
      }));
    if (rows.length) {
      const { error: eErr } = await supabase.from("counterparty_external_ids").insert(rows);
      if (eErr) {
        setError(eErr.message);
        setBusy(false);
        return;
      }
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
            <Select value={c.agent_id ?? ""} onChange={(v) => upd("agent_id", v)} placeholder="— нет —" options={[{ value: "", label: "— нет —" }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} />
          </F>
        )}
        {kinds.includes("agent") && (
          <>
            <F label="Номер договора"><input value={c.contract_number} onChange={(e) => upd("contract_number", e.target.value)} placeholder="№ …" className="input" /></F>
            <F label="Дата договора"><input type="date" value={c.contract_date} onChange={(e) => upd("contract_date", e.target.value)} className="input" /></F>
          </>
        )}
        <div className="sm:col-span-2"><F label="Заметка"><input value={c.note} onChange={(e) => upd("note", e.target.value)} className="input" /></F></div>
        <div className="sm:col-span-2 mt-1 border-t border-slate-200 pt-3 dark:border-white/[0.08]">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">Платёжные реквизиты</label>
          <PaymentFields value={pay} onChange={setPay} />
        </div>
        <div className="sm:col-span-2">
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
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy} className="btn-primary">{busy ? "…" : "Сохранить"}</button>
        <button onClick={() => setOpen(false)} className="btn-ghost">Отмена</button>
        <span className="ml-auto"><DeleteCounterpartyButton id={c.id} name={c.name} /></span>
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

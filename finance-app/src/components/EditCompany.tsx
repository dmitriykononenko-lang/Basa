"use client";

import { useState } from "react";
import { Select } from "@/components/ui/select";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CURRENCIES } from "@/lib/constants";

type Company = {
  id: string;
  name: string;
  base_currency: string;
  legal_name: string;
  inn: string;
  kpp: string;
  ogrn: string;
  address: string;
};

export default function EditCompany({ initial }: { initial: Company }) {
  const router = useRouter();
  const [c, setC] = useState<Company>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function upd(k: keyof Company, v: string) {
    setC((p) => ({ ...p, [k]: v }));
    setSaved(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("teams")
      .update({
        name: c.name,
        base_currency: c.base_currency,
        legal_name: c.legal_name || null,
        inn: c.inn || null,
        kpp: c.kpp || null,
        ogrn: c.ogrn || null,
        address: c.address || null,
      })
      .eq("id", c.id);
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    setBusy(false);
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="surface max-w-2xl space-y-4 p-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <F label="Название (отображается в шапке)">
          <input required value={c.name} onChange={(e) => upd("name", e.target.value)} className="input" />
        </F>
        <F label="Основная валюта">
          <Select value={c.base_currency} onChange={(v) => upd("base_currency", v)} options={CURRENCIES.map((x) => ({ value: x, label: x }))} />
        </F>
        <div className="sm:col-span-2">
          <F label="Юридическое наименование">
            <input value={c.legal_name} onChange={(e) => upd("legal_name", e.target.value)} placeholder='ООО «ГК Вектор»' className="input" />
          </F>
        </div>
        <F label="ИНН">
          <input value={c.inn} onChange={(e) => upd("inn", e.target.value)} className="input" />
        </F>
        <F label="КПП">
          <input value={c.kpp} onChange={(e) => upd("kpp", e.target.value)} className="input" />
        </F>
        <F label="ОГРН">
          <input value={c.ogrn} onChange={(e) => upd("ogrn", e.target.value)} className="input" />
        </F>
        <div className="sm:col-span-2">
          <F label="Адрес">
            <input value={c.address} onChange={(e) => upd("address", e.target.value)} className="input" />
          </F>
        </div>
      </div>
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="btn-primary">{busy ? "…" : "Сохранить"}</button>
        {saved && <span className="text-sm text-emerald-600 dark:text-emerald-400">Сохранено</span>}
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

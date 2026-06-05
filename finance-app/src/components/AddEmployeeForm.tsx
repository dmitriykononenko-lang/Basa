"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { EMPLOYMENT_TYPES, CURRENCIES } from "@/lib/constants";
import PaymentFields, { emptyPayment, type PaymentData } from "@/components/PaymentFields";

export default function AddEmployeeForm({ teamId }: { teamId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [type, setType] = useState("salary");
  const [currency, setCurrency] = useState("RUB");
  const [pay, setPay] = useState<PaymentData>(emptyPayment);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setCur(c: string) {
    setCurrency(c);
    // подсказка способа выплаты по валюте
    setPay((p) => ({ ...p, payment_method: c === "USDT" ? "crypto" : p.payment_method }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.from("employees").insert({
      team_id: teamId,
      name,
      start_date: startDate || null,
      employment_type: type,
      payout_currency: currency,
      payment_method: pay.payment_method,
      legal_status: pay.legal_status || null,
      payee_name: pay.payee_name || null,
      inn: pay.inn || null,
      bank_account: pay.bank_account || null,
      bank_name: pay.bank_name || null,
      bik: pay.bik || null,
      wallet_address: pay.wallet_address || null,
      wallet_network: pay.wallet_network || null,
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setName("");
    setStartDate("");
    setPay(emptyPayment);
    setOpen(false);
    setLoading(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        + Добавить сотрудника
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="w-full space-y-4 rounded-3xl bg-white p-5 ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.07]"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <F label="Имя">
          <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Иван Иванов" className="input" />
        </F>
        <F label="Дата начала">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input" />
        </F>
        <F label="Тип занятости">
          <select value={type} onChange={(e) => setType(e.target.value)} className="input">
            {EMPLOYMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </F>
        <F label="Валюта выплат">
          <select value={currency} onChange={(e) => setCur(e.target.value)} className="input">
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </F>
      </div>

      <div className="border-t border-slate-100 pt-4 dark:border-white/[0.06]">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
          Платёжные реквизиты
        </div>
        <PaymentFields value={pay} onChange={setPay} />
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={loading} className="btn-primary">{loading ? "…" : "Сохранить"}</button>
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

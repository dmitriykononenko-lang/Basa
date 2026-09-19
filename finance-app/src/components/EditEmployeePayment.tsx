"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import PaymentFields, { type PaymentData } from "@/components/PaymentFields";

export default function EditEmployeePayment({
  employeeId,
  initial,
}: {
  employeeId: string;
  initial: PaymentData;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<PaymentData>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("counterparties")
      .update({
        payment_method: value.payment_method,
        legal_status: value.legal_status || null,
        payee_name: value.payee_name || null,
        inn: value.inn || null,
        bank_account: value.bank_account || null,
        bank_name: value.bank_name || null,
        bik: value.bik || null,
        wallet_address: value.wallet_address || null,
        wallet_network: value.wallet_network || null,
      })
      .eq("id", employeeId);
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
        Редактировать реквизиты
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-2xl bg-slate-50 p-4 dark:bg-white/[0.03]">
      <PaymentFields value={value} onChange={setValue} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className="btn-primary">{busy ? "…" : "Сохранить"}</button>
        <button onClick={() => setOpen(false)} className="btn-ghost">Отмена</button>
      </div>
    </div>
  );
}

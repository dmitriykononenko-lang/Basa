"use client";

import { useState } from "react";
import { Select } from "@/components/ui/select";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import Modal from "@/components/Modal";
import PaymentFields, { emptyPayment, type PaymentData } from "@/components/PaymentFields";

type Category = { id: string; name: string };
type RuleDraft = { key: number; category_id: string; percent: string };

export default function AgentWizard({
  teamId, userId, incomeCategories,
}: {
  teamId: string;
  userId: string;
  incomeCategories: Category[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0); // 0 кто, 1 ставки, 2 реквизиты
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [contractNumber, setContractNumber] = useState("");
  const [contractDate, setContractDate] = useState("");
  const [rules, setRules] = useState<RuleDraft[]>([{ key: 1, category_id: "", percent: "" }]);
  const [pay, setPay] = useState<PaymentData>(emptyPayment);

  function reset() {
    setStep(0); setName(""); setContractNumber(""); setContractDate("");
    setRules([{ key: 1, category_id: "", percent: "" }]); setPay(emptyPayment); setError(null);
  }
  function addRule() { setRules((r) => [...r, { key: Date.now(), category_id: "", percent: "" }]); }
  function updRule(key: number, patch: Partial<RuleDraft>) { setRules((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x))); }
  function delRule(key: number) { setRules((r) => r.filter((x) => x.key !== key)); }

  async function finish() {
    setError(null);
    if (!name.trim()) { setStep(0); return setError("Укажите имя агента"); }
    setBusy(true);
    const supabase = createClient();
    const { data: cp, error: cpErr } = await supabase.from("counterparties").insert({
      team_id: teamId, name: name.trim(), kind: "agent", kinds: ["agent"],
      contract_number: contractNumber || null, contract_date: contractDate || null,
      payment_method: pay.payment_method, legal_status: pay.legal_status || null,
      payee_name: pay.payee_name || null, inn: pay.inn || null,
      bank_account: pay.bank_account || null, bank_name: pay.bank_name || null, bik: pay.bik || null,
      wallet_address: pay.wallet_address || null, wallet_network: pay.wallet_network || null,
    }).select("id").single();
    if (cpErr) { setBusy(false); return setError(cpErr.message); }
    const agentId = (cp as { id: string }).id;

    const ruleRows = rules
      .map((r) => ({ category_id: r.category_id || null, percent: parseFloat(r.percent.replace(",", ".")) }))
      .filter((r) => !isNaN(r.percent) && r.percent >= 0)
      .map((r) => ({ team_id: teamId, agent_id: agentId, category_id: r.category_id, percent: r.percent, created_by: userId }));
    if (ruleRows.length > 0) {
      const { error: rErr } = await supabase.from("agent_commission_rules").insert(ruleRows);
      if (rErr) { setBusy(false); return setError(rErr.message); }
    }
    setBusy(false);
    setOpen(false);
    reset();
    toast.success("Агент создан");
    router.refresh();
  }

  const steps = ["Договор", "Ставки", "Реквизиты"];

  return (
    <>
      <button onClick={() => { reset(); setOpen(true); }} className="btn-primary">+ Агент (мастер)</button>

      <Modal open={open} onClose={() => setOpen(false)} title="Новый агент">
        <div className="mb-4 flex gap-1">
          {steps.map((s, i) => (
            <div key={s} className={`flex-1 rounded-full px-2 py-1 text-center text-xs ${i === step ? "bg-brand text-white" : i < step ? "bg-brand/10 text-brand" : "bg-slate-100 text-slate-400 dark:bg-white/[0.06]"}`}>
              {i + 1}. {s}
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Имя агента *</label>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ИП Иванов / Агентство…" className="input" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Номер договора</label>
                <input value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} placeholder="№ …" className="input" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Дата договора</label>
                <input type="date" value={contractDate} onChange={(e) => setContractDate(e.target.value)} className="input" />
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-xs text-slate-400 dark:text-neutral-500">
              Ставка комиссии по статье дохода. «Все статьи» — по умолчанию. Можно добавить несколько.
            </p>
            {rules.map((r) => (
              <div key={r.key} className="flex flex-wrap items-end gap-2">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">Статья</label>
                  <Select value={r.category_id} onChange={(v) => updRule(r.key, { category_id: v })} placeholder="Все статьи (по умолчанию)" options={[{ value: "", label: "Все статьи (по умолчанию)" }, ...incomeCategories.map((c) => ({ value: c.id, label: c.name }))]} />
                </div>
                <div className="w-24">
                  <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">%</label>
                  <input value={r.percent} onChange={(e) => updRule(r.key, { percent: e.target.value })} inputMode="decimal" placeholder="10" className="input" />
                </div>
                <button type="button" onClick={() => delRule(r.key)} className="px-2 py-2 text-sm text-slate-400 hover:text-red-500">✕</button>
              </div>
            ))}
            <button type="button" onClick={addRule} className="text-sm text-brand">+ Ещё ставка</button>
          </div>
        )}

        {step === 2 && (
          <div>
            <p className="mb-3 text-xs text-slate-400 dark:text-neutral-500">Куда платить комиссию (необязательно — можно заполнить позже).</p>
            <PaymentFields value={pay} onChange={setPay} />
          </div>
        )}

        {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}

        <div className="mt-5 flex justify-between">
          <button onClick={() => (step === 0 ? setOpen(false) : setStep(step - 1))} className="btn-ghost">
            {step === 0 ? "Отмена" : "← Назад"}
          </button>
          {step < 2 ? (
            <button onClick={() => setStep(step + 1)} className="btn-primary">Далее →</button>
          ) : (
            <button onClick={finish} disabled={busy} className="btn-primary">{busy ? "Создаём…" : "Создать агента"}</button>
          )}
        </div>
      </Modal>
    </>
  );
}

"use client";

import { useState } from "react";
import { Select } from "@/components/ui/select";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMoney, formatMoney } from "@/lib/format";
import { CURRENCIES } from "@/lib/constants";
import { toast } from "@/lib/toast";
import Modal from "@/components/Modal";

type Cat = { id: string; name: string; kind: string };
type Proj = { id: string; name: string };

export type ObligationEdit = {
  id: string;
  type: "payable" | "receivable";
  amount: number;
  currency: string;
  due_date: string | null;
  period_month: string | null;
  pay_part: "fixed" | "variable" | null;
  project_id: string | null;
  category_id: string | null;
  note: string | null;
  paid: number;
};

// Редактирование/удаление обязательства (в т.ч. начисления зарплаты).
export default function EditObligationForm({
  obligation,
  categories = [],
  projects = [],
  mode,
}: {
  obligation: ObligationEdit;
  categories?: Cat[];
  projects?: Proj[];
  mode: "accrual" | "general";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState((obligation.amount / 100).toFixed(2).replace(".", ","));
  const [currency, setCurrency] = useState(obligation.currency);
  const [month, setMonth] = useState((obligation.period_month ?? obligation.due_date ?? "").slice(0, 7));
  const [dueDate, setDueDate] = useState(obligation.due_date ?? "");
  const [payPart, setPayPart] = useState<"fixed" | "variable">(obligation.pay_part ?? "fixed");
  const [projectId, setProjectId] = useState(obligation.project_id ?? "");
  const [categoryId, setCategoryId] = useState(obligation.category_id ?? "");
  const [note, setNote] = useState(obligation.note ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expenseCats = categories.filter((c) => c.kind === "expense");
  const hasPaid = obligation.paid > 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const minor = parseMoney(amount);
    if (minor <= 0) return setError("Сумма больше нуля");
    if (minor < obligation.paid)
      return setError(`Сумма меньше уже выплаченного (${formatMoney(obligation.paid, currency)}). Сначала отмените выплаты.`);

    setLoading(true);
    const supabase = createClient();
    const patch: Record<string, unknown> = {
      amount: minor,
      currency,
      category_id: categoryId || null,
      note: note || null,
    };
    if (mode === "accrual") {
      patch.period_month = month ? `${month}-01` : null;
      patch.due_date = month ? `${month}-01` : null;
      patch.pay_part = payPart;
      patch.project_id = projectId || null;
    } else {
      patch.due_date = dueDate || null;
    }
    const { error } = await supabase.from("obligations").update(patch).eq("id", obligation.id);
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setOpen(false);
    setLoading(false);
    toast.success("Сохранено");
    router.refresh();
  }

  async function remove() {
    if (hasPaid) {
      setError("По обязательству есть выплаты — сначала отмените их.");
      return;
    }
    if (!confirm("Удалить начисление? Действие необратимо.")) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.from("obligations").delete().eq("id", obligation.id);
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setOpen(false);
    setLoading(false);
    toast.success("Удалено");
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-full px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
      >
        Изм.
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={mode === "accrual" ? "Начисление" : "Обязательство"}>
        <form onSubmit={save} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Сумма">
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="input" />
            </Field>
            <Field label="Валюта">
              <Select value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
            </Field>

            {mode === "accrual" ? (
              <>
                <Field label="Месяц">
                  <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="input" />
                </Field>
                <Field label="Часть">
                  <Select value={payPart} onChange={(v) => setPayPart(v as "fixed" | "variable")} options={[{ value: "fixed", label: "Фиксированная" }, { value: "variable", label: "Переменная" }]} />
                </Field>
                {projects.length > 0 && (
                  <Field label="Проект">
                    <Select value={projectId} onChange={setProjectId} placeholder="— без проекта —" options={[{ value: "", label: "— без проекта —" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
                  </Field>
                )}
              </>
            ) : (
              <Field label="Срок">
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input" />
              </Field>
            )}

            {expenseCats.length > 0 && (
              <Field label="Статья">
                <Select value={categoryId} onChange={setCategoryId} placeholder="— не указана —" options={[{ value: "", label: "— не указана —" }, ...expenseCats.map((c) => ({ value: c.id, label: c.name }))]} />
              </Field>
            )}
          </div>
          <Field label="Заметка">
            <input value={note} onChange={(e) => setNote(e.target.value)} className="input" placeholder="Необязательно" />
          </Field>

          {hasPaid && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              Уже выплачено {formatMoney(obligation.paid, obligation.currency)}. Удаление недоступно; сумму нельзя сделать меньше выплаченного.
            </p>
          )}
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}

          <div className="flex items-center justify-between gap-2 pt-1">
            <button type="button" onClick={remove} disabled={loading || hasPaid}
              className="rounded-full px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-950/40">
              Удалить
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Отмена</button>
              <button type="submit" disabled={loading} className="btn-primary">{loading ? "…" : "Сохранить"}</button>
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">{label}</label>
      {children}
    </div>
  );
}

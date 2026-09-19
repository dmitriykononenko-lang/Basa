"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import Modal from "@/components/Modal";

// Карточка должности сотрудника: продукт (ЦКП) + функции-теги. Редактируется инлайн.
export default function EmployeeProductCard({
  employeeId,
  product,
  functions,
  canManage,
}: {
  employeeId: string;
  product: string | null;
  functions: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prod, setProd] = useState(product ?? "");
  const [func, setFunc] = useState(functions ?? "");

  const tags = (functions ?? "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  const hasContent = !!(product?.trim() || tags.length);

  // Пустая карточка без прав редактирования — не показываем.
  if (!hasContent && !canManage) return null;

  async function save() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("counterparties")
      .update({ product_text: prod.trim() || null, functions_text: func.trim() || null })
      .eq("id", employeeId);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Сохранено");
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="mb-4 rounded-3xl bg-white p-5 ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">Продукт должности</h2>
        {canManage && (
          <button type="button" onClick={() => { setProd(product ?? ""); setFunc(functions ?? ""); setOpen(true); }} className="btn-ghost px-2 py-1 text-xs">
            {hasContent ? "Изменить" : "Заполнить"}
          </button>
        )}
      </div>

      {hasContent ? (
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand/10 text-brand">📦</span>
          <div className="min-w-0">
            <div className="text-[15px] font-bold text-slate-900 dark:text-white">
              {product?.trim() || "Продукт не указан"}
            </div>
            {tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((t, i) => (
                  <span key={i} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-white/[0.06] dark:text-neutral-300">{t}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-400 dark:text-neutral-500">Опишите продукт (ЦКП) сотрудника и его функции.</p>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Продукт должности" size="lg">
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Продукт (ЦКП)</span>
            <textarea value={prod} onChange={(e) => setProd(e.target.value)} rows={2} className="input resize-y" placeholder="Что производит сотрудник — ценный конечный продукт" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Функции</span>
            <textarea value={func} onChange={(e) => setFunc(e.target.value)} rows={4} className="input resize-y" placeholder="Через запятую или по строкам — станут тегами" />
            <span className="mt-1 block text-[11px] text-slate-400">Показываются тегами в карточке должности.</span>
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Отмена</button>
            <button type="button" disabled={busy} onClick={save} className="btn-primary">{busy ? "…" : "Сохранить"}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

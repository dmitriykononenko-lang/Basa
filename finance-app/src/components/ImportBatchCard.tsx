"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/format";

export type Batch = {
  id: string;
  file_name: string;
  created_at: string;
  row_count: number;
  status: string;
  bank: string | null;
  account: { name: string } | null;
};

export default function ImportBatchCard({ batch }: { batch: Batch }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function undo() {
    if (!confirm(`Отменить импорт «${batch.file_name}» и удалить ${batch.row_count} операций? Счета не удаляются.`)) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.from("import_batches").delete().eq("id", batch.id);
    if (error) { setError(error.message); setBusy(false); return; }
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-slate-800 dark:text-neutral-200">{batch.file_name}</div>
        <div className="text-xs text-slate-400 dark:text-neutral-500">
          {formatDate(batch.created_at)} · операций: {batch.row_count}
          {batch.account?.name && <> · счёт: {batch.account.name}</>}
          {batch.bank && <> · {batch.bank}</>}
        </div>
        {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
      </div>
      <button
        onClick={undo}
        disabled={busy}
        className="shrink-0 rounded-full bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 ring-1 ring-red-200 transition hover:bg-red-100 disabled:opacity-50 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900/40"
      >
        {busy ? "Отменяем…" : "Отменить импорт"}
      </button>
    </div>
  );
}

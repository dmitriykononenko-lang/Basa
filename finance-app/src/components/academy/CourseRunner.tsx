"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";

export type CourseItemView = {
  itemId: string;
  articleId: string;
  title: string;
  done: boolean;
};

export default function CourseRunner({ items }: { items: CourseItemView[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const currentIdx = items.findIndex((i) => !i.done);

  async function complete(itemId: string) {
    setBusyId(itemId);
    const supabase = createClient();
    const { error } = await supabase.rpc("academy_complete_item", { _item_id: itemId });
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Отмечено пройденным");
    router.refresh();
  }

  return (
    <ol className="relative space-y-1">
      {items.map((it, i) => {
        const isCurrent = i === currentIdx;
        const state = it.done ? "done" : isCurrent ? "current" : "todo";
        return (
          <li key={it.itemId} className="relative flex gap-4 pb-1">
            {/* линия-коннектор */}
            {i < items.length - 1 && (
              <span className={`absolute left-[15px] top-9 h-[calc(100%-1rem)] w-px ${it.done ? "bg-brand/40" : "bg-slate-200 dark:bg-white/10"}`} />
            )}
            {/* кружок */}
            <span
              className={`z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-4 ring-white dark:ring-[#0f1115] ${
                state === "done"
                  ? "bg-brand text-white"
                  : state === "current"
                    ? "bg-brand/15 text-brand"
                    : "bg-slate-100 text-slate-400 dark:bg-neutral-800 dark:text-neutral-500"
              }`}
            >
              {it.done ? "✓" : i + 1}
            </span>
            {/* контент */}
            <div className={`flex-1 rounded-2xl border p-4 transition ${state === "current" ? "border-brand/40 bg-brand/[0.03]" : "border-slate-200 dark:border-white/10"} mb-2`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/knowledge-base/${it.articleId}`} className="font-medium text-slate-900 hover:text-brand dark:text-white">
                  {it.title}
                </Link>
                {it.done ? (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">✓ Пройдено</span>
                ) : (
                  <div className="flex gap-2">
                    <Link href={`/knowledge-base/${it.articleId}`} className="btn-ghost text-sm">Открыть</Link>
                    <button type="button" disabled={busyId === it.itemId} onClick={() => complete(it.itemId)} className="btn-primary text-sm">
                      {busyId === it.itemId ? "…" : "Отметить пройденным"}
                    </button>
                  </div>
                )}
              </div>
              {state === "current" && <p className="mt-1 text-xs text-brand">Текущий шаг</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

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
    <ol className="space-y-3">
      {items.map((it, i) => (
        <li key={it.itemId} className="surface flex flex-wrap items-center gap-3 rounded-3xl p-4">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500 dark:bg-neutral-800 dark:text-neutral-300">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <Link href={`/knowledge-base/${it.articleId}`} className="font-medium text-slate-900 hover:text-brand dark:text-white">
              {it.title}
            </Link>
          </div>
          {it.done ? (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
              ✓ Пройдено
            </span>
          ) : (
            <div className="flex gap-2">
              <Link href={`/knowledge-base/${it.articleId}`} className="btn-ghost text-sm">Открыть</Link>
              <button type="button" disabled={busyId === it.itemId} onClick={() => complete(it.itemId)} className="btn-primary text-sm">
                {busyId === it.itemId ? "…" : "Отметить пройденным"}
              </button>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

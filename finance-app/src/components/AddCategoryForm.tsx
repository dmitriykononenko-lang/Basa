"use client";

import { useState } from "react";
import { Select } from "@/components/ui/select";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Category = { id: string; name: string; kind: "income" | "expense" };

export default function AddCategoryForm({
  teamId,
  categories,
}: {
  teamId: string;
  categories: Category[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [parentId, setParentId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parents = categories.filter((c) => c.kind === kind);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.from("categories").insert({
      team_id: teamId,
      name,
      kind,
      parent_id: parentId || null,
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setName("");
    setOpen(false);
    setLoading(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        + Добавить статью
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-end gap-3 rounded-3xl bg-white p-4 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]"
    >
      <div className="grid grid-cols-2 gap-1 rounded-full bg-slate-100 p-1 text-sm dark:bg-neutral-800">
        {(
          [
            ["expense", "Расход"],
            ["income", "Доход"],
          ] as ["income" | "expense", string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setKind(k);
              setParentId("");
            }}
            className={`rounded-full px-3 py-1.5 font-medium transition ${
              kind === k
                ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white"
                : "text-slate-500 dark:text-neutral-400"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-w-[180px] flex-1">
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">
          Название статьи
        </label>
        <input
          type="text"
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Например, Подрядчики"
          className="input"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">
          Группа (необяз.)
        </label>
        <Select value={parentId} onChange={setParentId} placeholder="— верхний уровень —" options={[{ value: "", label: "— верхний уровень —" }, ...parents.map((c) => ({ value: c.id, label: c.name }))]} />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? "…" : "Сохранить"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
          Отмена
        </button>
      </div>
      {error && (
        <p className="w-full rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">
          {error}
        </p>
      )}
    </form>
  );
}

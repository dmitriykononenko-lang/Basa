"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { ROLE_LABELS, type AppRole } from "@/lib/types";
import { VIS_RESOURCES, type VisibilityMap, type MemberOverrides } from "@/lib/visibility";

// Видимость разделов для конкретного сотрудника: «по роли (шаблон)» или
// «индивидуально» (переопределение поверх роли).
export default function MemberVisibility({
  teamId,
  userId,
  memberRole,
  templates,
  initialOverrides,
}: {
  teamId: string;
  userId: string;
  memberRole: AppRole;
  templates: VisibilityMap;
  initialOverrides: MemberOverrides;
}) {
  const router = useRouter();
  // Что даёт роль по шаблону (для режима «по роли» и как значение по умолчанию).
  const roleVisible = (res: string) => {
    const allowed = templates[res];
    return allowed ? allowed.includes(memberRole) : true;
  };

  const hasOverrides = Object.keys(initialOverrides).length > 0;
  const [mode, setMode] = useState<"role" | "custom">(hasOverrides ? "custom" : "role");
  const [state, setState] = useState<Record<string, boolean>>(() => {
    const s: Record<string, boolean> = {};
    for (const r of VIS_RESOURCES) s[r.key] = r.key in initialOverrides ? initialOverrides[r.key] : roleVisible(r.key);
    return s;
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const supabase = createClient();
    if (mode === "role") {
      // убираем индивидуальные правила — сотрудник следует шаблону роли
      const { error } = await supabase.from("member_visibility").delete().eq("team_id", teamId).eq("user_id", userId);
      setBusy(false);
      if (error) return toast.error(error.message);
      toast.success("Видимость: по роли");
      router.refresh();
      return;
    }
    const rows = VIS_RESOURCES.map((r) => ({ team_id: teamId, user_id: userId, resource: r.key, visible: state[r.key] }));
    const { error } = await supabase.from("member_visibility").upsert(rows, { onConflict: "team_id,user_id,resource" });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Индивидуальная видимость сохранена");
    router.refresh();
  }

  return (
    <div className="mt-4 rounded-3xl bg-white p-6 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <h2 className="text-sm font-semibold text-slate-800 dark:text-neutral-100">Видимость разделов</h2>
      <p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">
        Что этот сотрудник видит в приложении.
      </p>

      <div className="mt-4 inline-flex rounded-full bg-slate-100 p-1 text-sm dark:bg-neutral-800">
        <button
          type="button"
          onClick={() => setMode("role")}
          className={`rounded-full px-4 py-1.5 font-medium transition ${mode === "role" ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 dark:text-neutral-400"}`}
        >
          По роли «{ROLE_LABELS[memberRole]}»
        </button>
        <button
          type="button"
          onClick={() => setMode("custom")}
          className={`rounded-full px-4 py-1.5 font-medium transition ${mode === "custom" ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 dark:text-neutral-400"}`}
        >
          Индивидуально
        </button>
      </div>

      <div className="mt-4 divide-y divide-slate-50 dark:divide-white/[0.05]">
        {VIS_RESOURCES.map((r) => {
          const shown = mode === "role" ? roleVisible(r.key) : state[r.key];
          return (
            <label key={r.key} className={`flex items-center justify-between gap-3 py-3 ${mode === "role" ? "opacity-70" : ""}`}>
              <span>
                <span className="block text-sm font-medium text-slate-800 dark:text-neutral-100">{r.label}</span>
                <span className="block text-xs text-slate-400 dark:text-neutral-500">{r.desc}</span>
              </span>
              <input
                type="checkbox"
                disabled={mode === "role"}
                checked={shown}
                onChange={() => setState((p) => ({ ...p, [r.key]: !p[r.key] }))}
                className="h-4 w-4 shrink-0 rounded border-slate-300 text-brand focus:ring-brand disabled:opacity-50"
              />
            </label>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-400 dark:text-neutral-500">
          {mode === "role" ? "Меняется вместе с шаблоном роли." : "Переопределяет шаблон роли для этого человека."}
        </p>
        <button type="button" onClick={save} disabled={busy} className="btn-primary">
          {busy ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}

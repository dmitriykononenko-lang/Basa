"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";

export default function DeleteProjectButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function del() {
    if (!confirm(`Удалить проект «${name}»? Если есть связанные операции — проект будет архивирован.`)) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) {
      const { error: e2 } = await supabase.from("projects").update({ archived: true }).eq("id", id);
      setBusy(false);
      if (e2) return toast.error(e2.message);
      toast.success("Проект архивирован (есть связанные операции)");
    } else {
      setBusy(false);
      toast.success("Проект удалён");
    }
    router.push("/projects");
    router.refresh();
  }

  return (
    <button
      onClick={del}
      disabled={busy}
      className="rounded-full px-3 py-1.5 text-sm font-medium text-red-500 transition hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/40"
    >
      Удалить
    </button>
  );
}

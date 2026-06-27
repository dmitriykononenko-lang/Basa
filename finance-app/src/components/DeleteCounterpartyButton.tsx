"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";

export default function DeleteCounterpartyButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function del() {
    if (!confirm(`Удалить контрагента «${name}»? Если есть связанные операции — он будет архивирован.`)) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("counterparties").delete().eq("id", id);
    if (error) {
      const { error: e2 } = await supabase.from("counterparties").update({ archived: true }).eq("id", id);
      setBusy(false);
      if (e2) return toast.error(e2.message);
      toast.success("Контрагент архивирован (есть связанные операции)");
    } else {
      setBusy(false);
      toast.success("Контрагент удалён");
    }
    router.push("/counterparties");
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

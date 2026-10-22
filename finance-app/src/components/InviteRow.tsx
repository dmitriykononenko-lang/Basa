"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function InviteRevoke({ inviteId }: { inviteId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function revoke() {
    setBusy(true);
    const supabase = createClient();
    await supabase.from("invites").delete().eq("id", inviteId);
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      onClick={revoke}
      disabled={busy}
      className="rounded-full px-2 py-1 text-xs text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950/40"
    >
      Отозвать
    </button>
  );
}

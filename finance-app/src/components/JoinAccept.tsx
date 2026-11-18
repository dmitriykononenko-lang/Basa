"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function JoinAccept({ inviteId }: { inviteId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { error } = await supabase.rpc("accept_invite", { _invite_id: inviteId });
      if (error) {
        setStatus("error");
        setMessage(error.message);
        return;
      }
      setStatus("ok");
      setTimeout(() => {
        router.push("/dashboard");
        router.refresh();
      }, 1200);
    })();
  }, [inviteId, router]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="surface w-full max-w-md p-8 text-center">
        {status === "loading" && (
          <p className="text-sm text-slate-500 dark:text-neutral-400">Принимаем приглашение…</p>
        )}
        {status === "ok" && (
          <>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-600 dark:bg-emerald-950/50">
              ✓
            </div>
            <p className="text-sm text-slate-700 dark:text-neutral-200">
              Готово! Вы присоединились к команде. Открываем дашборд…
            </p>
          </>
        )}
        {status === "error" && (
          <>
            <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">
              {message || "Не удалось принять приглашение"}
            </p>
            <p className="text-xs text-slate-400">
              Возможно, приглашение оформлено на другой email или уже использовано.
            </p>
            <button
              onClick={() => router.push("/dashboard")}
              className="btn-primary mt-4"
            >
              На дашборд
            </button>
          </>
        )}
      </div>
    </main>
  );
}

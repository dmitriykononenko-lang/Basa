"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={signOut}
      className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
    >
      Выйти
    </button>
  );
}

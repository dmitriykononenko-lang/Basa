import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Sidebar from "@/components/Sidebar";
import SignOutButton from "@/components/SignOutButton";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  const displayName = profile?.full_name ?? user.email ?? "Пользователь";

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r border-slate-200 bg-white py-5">
        <div className="px-6 pb-5">
          <div className="text-lg font-semibold text-slate-900">
            Basa Finance
          </div>
        </div>

        <Sidebar />

        <div className="mt-auto border-t border-slate-200 px-3 pt-3">
          <div className="px-3 pb-1 text-sm font-medium text-slate-700">
            {displayName}
          </div>
          <div className="truncate px-3 pb-2 text-xs text-slate-400">
            {user.email}
          </div>
          <SignOutButton />
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}

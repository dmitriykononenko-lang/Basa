import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam } from "@/lib/team";
import Sidebar from "@/components/Sidebar";
import SignOutButton from "@/components/SignOutButton";
import Brand from "@/components/Brand";
import ThemeToggle from "@/components/ThemeToggle";
import NavProgress from "@/components/NavProgress";
import { IconBell, IconChevronDown } from "@/components/icons";

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

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

  const current = await getCurrentTeam();
  const company = current?.team.name ?? null;

  return (
    <div className="min-h-screen p-2 sm:p-3">
      <div className="surface relative flex min-h-[calc(100vh-1rem)] flex-col overflow-hidden sm:min-h-[calc(100vh-1.5rem)]">
        <NavProgress />
        {/* Шапка */}
        <header className="relative flex h-16 items-center justify-between border-b border-slate-100 px-4 dark:border-white/[0.07] sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2.5 rounded-full bg-slate-100 py-1.5 pl-1.5 pr-3 dark:bg-neutral-800">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">
                {initials(company ?? displayName)}
              </span>
              <span className="flex min-w-0 flex-col leading-tight">
                <span
                  className="max-w-[200px] truncate text-sm font-semibold text-slate-800 dark:text-neutral-100"
                  title={company ?? displayName}
                >
                  {company ?? displayName}
                </span>
                {company && (
                  <span className="max-w-[200px] truncate text-[11px] text-slate-400 dark:text-neutral-500">
                    {displayName}
                  </span>
                )}
              </span>
              <IconChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
            </div>
            <button
              type="button"
              className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 dark:hover:bg-neutral-800"
              aria-label="Уведомления"
            >
              <IconBell className="h-[18px] w-[18px]" />
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent" />
            </button>
          </div>

          <div className="absolute left-1/2 -translate-x-1/2">
            <Brand />
          </div>

          <ThemeToggle />
        </header>

        {/* Тело */}
        <div className="flex flex-1">
          <aside className="flex w-60 shrink-0 flex-col py-4">
            <Sidebar />
            <div className="mt-auto px-3 pt-3">
              <SignOutButton />
            </div>
          </aside>

          <main className="flex-1 p-2 sm:p-3">
            <div className="h-full overflow-y-auto rounded-3xl bg-slate-50 dark:bg-neutral-950/40">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

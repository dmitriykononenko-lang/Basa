import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { loadRoleTemplates, loadMemberOverrides, hiddenHrefs } from "@/lib/visibility";
import Sidebar from "@/components/Sidebar";
import NextPaymentCard, { type NextPayment } from "@/components/NextPaymentCard";
import MobileNav from "@/components/MobileNav";
import SignOutButton from "@/components/SignOutButton";
import Brand from "@/components/Brand";
import ThemeToggle from "@/components/ThemeToggle";
import NavProgress from "@/components/NavProgress";
import Toaster from "@/components/Toaster";
import TochkaAutoSync from "@/components/TochkaAutoSync";
import CommandPalette from "@/components/CommandPalette";
import CommandPaletteButton from "@/components/CommandPaletteButton";
import NotificationBell from "@/components/NotificationBell";
import { IconChevronDown } from "@/components/icons";

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
    .maybeSingle();

  const displayName = profile?.full_name ?? user.email ?? "Пользователь";

  const current = await getCurrentTeam();
  const company = current?.team.name ?? null;

  // Скрытие разделов по видимости: шаблон роли + индивидуальные переопределения.
  const [tmpl, ovr] = current
    ? await Promise.all([
        loadRoleTemplates(supabase, current.team.id),
        loadMemberOverrides(supabase, current.team.id, user.id),
      ])
    : [{}, {}];
  const hidden = current ? hiddenHrefs(current.role, tmpl, ovr) : [];
  // «ОС компании» — обзор для руководителей (owner/admin/manager).
  if (current && !canEditFinance(current.role)) hidden.push("/os");

  // Ближайший плановый платёж (расход) — карточка внизу сайдбара.
  let nextPayment: NextPayment | null = null;
  if (current && canEditFinance(current.role)) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: np } = await supabase
      .from("transactions")
      .select("id, amount, currency, occurred_on, note, category:categories(name)")
      .eq("team_id", current.team.id)
      .eq("status", "planned")
      .eq("type", "expense")
      .gte("occurred_on", today)
      .order("occurred_on", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (np) {
      const cat = np.category as { name: string } | { name: string }[] | null;
      const catName = Array.isArray(cat) ? cat[0]?.name : cat?.name;
      nextPayment = {
        id: np.id as string,
        title: catName || (np.note as string | null) || "Платёж",
        amount: np.amount as number,
        currency: np.currency as string,
        date: np.occurred_on as string,
      };
    }
  }

  return (
    <div className="min-h-screen p-2 sm:p-3">
      <div className="surface relative flex min-h-[calc(100vh-1rem)] flex-col overflow-hidden sm:min-h-[calc(100vh-1.5rem)]">
        <NavProgress />
        {/* Шапка */}
        <header className="relative flex h-16 items-center justify-between border-b border-slate-100 px-4 dark:border-white/[0.07] sm:px-6">
          <div className="flex items-center gap-2">
            <Link
              href="/profile"
              className="flex items-center gap-2.5 rounded-full bg-slate-100 py-1.5 pl-1.5 pr-3 transition hover:bg-slate-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
              title="Профиль и настройки"
            >
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
            </Link>
            <NotificationBell />
          </div>

          <div className="absolute left-1/2 -translate-x-1/2">
            <Brand />
          </div>

          <div className="flex items-center gap-2">
            <CommandPaletteButton />
            <ThemeToggle />
          </div>
        </header>
        <Toaster />
        {current && canEditFinance(current.role) && <TochkaAutoSync />}
        <CommandPalette />

        {/* Мобильное меню (только узкие экраны) */}
        <MobileNav hidden={hidden} />

        {/* Тело */}
        <div className="flex flex-1">
          <aside className="hidden w-60 shrink-0 flex-col py-4 md:flex">
            <Sidebar hidden={hidden} />
            <div className="mt-auto space-y-3 px-3 pt-3">
              {nextPayment && <NextPaymentCard payment={nextPayment} />}
              <SignOutButton />
            </div>
          </aside>

          <main className="min-w-0 flex-1 p-2 sm:p-3">
            <div className="h-full overflow-y-auto rounded-3xl bg-slate-50 dark:bg-neutral-950/40">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

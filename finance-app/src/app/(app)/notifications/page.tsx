import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import NotificationList, { type NotificationRow } from "@/components/NotificationList";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("notifications")
    .select("id, type, severity, title, body, link, created_at, read_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const items = (data ?? []) as NotificationRow[];

  return (
    <div className="mx-auto max-w-3xl p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Уведомления</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
          Кассовые разрывы, просрочки, перерасход бюджета, дедлайны обучения
        </p>
      </header>
      <NotificationList initial={items} />
    </div>
  );
}

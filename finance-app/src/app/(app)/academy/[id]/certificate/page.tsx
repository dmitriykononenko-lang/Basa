import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam } from "@/lib/team";
import PrintButton from "@/components/PrintButton";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const current = await getCurrentTeam();
  if (!current) redirect("/academy");
  const { team } = current;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id ?? "";

  const { data: course } = await supabase
    .from("academy_courses")
    .select("id, title")
    .eq("id", id)
    .maybeSingle();
  if (!course) notFound();
  const c = course as { id: string; title: string };

  const { data: items } = await supabase
    .from("academy_course_items")
    .select("id")
    .eq("course_id", id);
  const total = (items ?? []).length;

  const { data: prog } = await supabase
    .from("academy_progress")
    .select("status, completed_at")
    .eq("course_id", id)
    .eq("user_id", uid);
  const rows = (prog ?? []) as { status: string; completed_at: string | null }[];
  const doneRows = rows.filter((r) => r.status === "done");

  // сертификат доступен только при 100% завершении
  if (total === 0 || doneRows.length < total) redirect(`/academy/${id}`);

  const completedAt = doneRows
    .map((r) => r.completed_at)
    .filter(Boolean)
    .sort()
    .pop() as string | null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", uid)
    .maybeSingle();
  const fullName = (profile as { full_name: string | null } | null)?.full_name || "Сотрудник";

  return (
    <div className="p-6 sm:p-8">
      <div className="no-print mb-4 flex items-center justify-between gap-3">
        <Link href={`/academy/${id}`} className="text-sm text-slate-400 hover:text-brand">← К курсу</Link>
        <PrintButton label="Печать / PDF" />
      </div>

      <div className="print-area mx-auto max-w-3xl">
        <div className="kb-certificate">
          <div className="kb-certificate__badge">🎓</div>
          <div className="kb-certificate__kicker">Сертификат о прохождении обучения</div>
          <div className="kb-certificate__name">{fullName}</div>
          <div className="kb-certificate__text">успешно прошёл(ла) курс</div>
          <div className="kb-certificate__course">«{c.title}»</div>
          <div className="kb-certificate__meta">
            <span>{team.name}</span>
            <span>Дата: {fmtDate(completedAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

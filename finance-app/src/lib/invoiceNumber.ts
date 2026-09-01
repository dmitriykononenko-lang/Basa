import type { SupabaseClient } from "@supabase/supabase-js";

// Нумерация документов KO Agency: KO-NNN-INV-XX
//   NNN — сквозной номер проекта (из префикса «[NNN]» в названии проекта);
//   XX  — порядковый номер инвойса ВНУТРИ проекта (свой счётчик у каждого типа).
// Валюта на номер не влияет. Старый формат KO-YYYY-MM-NNN не трогаем.

// Сквозной номер проекта NNN из его названия («[126] Maison …» → «126»).
export function extractProjectNNN(name: string | null | undefined): string | null {
  const m = /^\s*\[(\d+)\]/.exec(name ?? "");
  return m ? m[1] : null;
}

// Считается ли номер «нашим» авто-форматом KO-NNN-INV-XX (можно переприсвоить).
export function isAutoInvoiceNumber(n: string): boolean {
  return /^KO-\d+-INV-\d+$/.test(n.trim());
}

// Следующий номер инвойса по конкретному проекту. null — если у проекта нет NNN.
export async function nextInvoiceNumberForProject(
  supabase: SupabaseClient,
  teamId: string,
  projectId: string,
): Promise<string | null> {
  const { data: proj } = await supabase
    .from("projects").select("name").eq("id", projectId).eq("team_id", teamId).maybeSingle();
  const nnn = extractProjectNNN(proj?.name as string | null);
  if (!nnn) return null;

  const { data } = await supabase
    .from("invoices").select("number").eq("team_id", teamId).like("number", `KO-${nnn}-INV-%`);
  const re = new RegExp(`^KO-${nnn}-INV-(\\d+)$`);
  let max = 0;
  for (const r of (data ?? []) as { number: string | null }[]) {
    const m = re.exec((r.number ?? "").trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `KO-${nnn}-INV-${String(max + 1).padStart(2, "0")}`;
}

// Карта проект→следующий номер (для подсказки в форме) одним запросом по всем инвойсам.
export async function nextInvoiceNumbersByProject(
  supabase: SupabaseClient,
  teamId: string,
  projects: { id: string; name: string }[],
): Promise<Record<string, string>> {
  const { data } = await supabase
    .from("invoices").select("number").eq("team_id", teamId).like("number", "KO-%-INV-%");
  const maxByNNN = new Map<string, number>();
  for (const r of (data ?? []) as { number: string | null }[]) {
    const m = /^KO-(\d+)-INV-(\d+)$/.exec((r.number ?? "").trim());
    if (m) maxByNNN.set(m[1], Math.max(maxByNNN.get(m[1]) ?? 0, parseInt(m[2], 10)));
  }
  const out: Record<string, string> = {};
  for (const p of projects) {
    const nnn = extractProjectNNN(p.name);
    if (!nnn) continue;
    out[p.id] = `KO-${nnn}-INV-${String((maxByNNN.get(nnn) ?? 0) + 1).padStart(2, "0")}`;
  }
  return out;
}

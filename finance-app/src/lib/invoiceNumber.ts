import type { SupabaseClient } from "@supabase/supabase-js";

// Следующий номер счёта формата ГГГГ-NNN — последовательный за текущий год.
// Учитываем только номера нашего формата; импортированные «чужие» номера
// (Точка 7366778, крипто KO-126-INV-02 и т.п.) игнорируем, чтобы не сбить счётчик.
export async function nextInvoiceNumber(
  supabase: SupabaseClient,
  teamId: string,
  year: number = new Date().getFullYear(),
): Promise<string> {
  const prefix = `${year}-`;
  const { data } = await supabase
    .from("invoices")
    .select("number")
    .eq("team_id", teamId)
    .like("number", `${prefix}%`);
  let max = 0;
  for (const r of (data ?? []) as { number: string | null }[]) {
    const m = /^(\d{4})-(\d+)$/.exec((r.number ?? "").trim());
    if (m && m[1] === String(year)) max = Math.max(max, parseInt(m[2], 10));
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

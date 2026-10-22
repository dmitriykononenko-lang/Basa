import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/api-validation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";

// Явная команда «досоздать авто-начисления» (зарплата в авто-режиме и циклы
// поддержки). Раньше это выполнялось при GET-рендере /payroll — то есть простое
// открытие страницы писало в БД, а два параллельных рендера давали двойное
// начисление (аудит, тест T1). Теперь это POST-команда, а идемпотентность и
// сериализация обеспечиваются в БД (миграция 0087: advisory-lock + уникальный
// индекс obligations_auto_accrual_uniq).
export async function POST(request: Request) {
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Нет команды" }, { status: 400 });
  if (!canEditFinance(current.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  const p = await parseJson(request, z.object({}).passthrough().optional());
  if (!p.ok) return p.res;

  const supabase = await createClient();
  const { data: accruals, error: e1 } = await supabase.rpc("materialize_auto_accruals", { p_team: current.team.id });
  if (e1) return NextResponse.json({ error: e1.message }, { status: 400 });
  const { data: cycles, error: e2 } = await supabase.rpc("materialize_support_cycles", { p_team: current.team.id });
  if (e2) return NextResponse.json({ error: e2.message }, { status: 400 });

  return NextResponse.json({ ok: true, accruals: accruals ?? 0, cycles: cycles ?? 0 });
}

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Закрытие просроченных ссылок и удаление неразобранного шифртекста (Vercel Cron).
// Защита — CRON_SECRET, как у остальных кронов.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: true, skipped: "CRON_SECRET не задан" });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Нет service-role ключа" }, { status: 500 });
  const { data, error } = await admin.rpc("vault_intake_expire");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, expired: data ?? 0 });
}

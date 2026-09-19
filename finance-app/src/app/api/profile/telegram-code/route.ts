import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateLinkCode, hashLinkCode } from "@/lib/telegram";

export const dynamic = "force-dynamic";

const TTL_MIN = 15;

// Генерация одноразового кода привязки Telegram. Работает под сессией веба
// (RLS: пользователь пишет только свою строку telegram_link_codes).
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const code = generateLinkCode();
  const expiresAt = new Date(Date.now() + TTL_MIN * 60_000).toISOString();

  const { error } = await supabase.from("telegram_link_codes").upsert(
    {
      user_id: user.id,
      email: user.email.toLowerCase(),
      code_hash: hashLinkCode(code),
      expires_at: expiresAt,
    },
    { onConflict: "user_id" },
  );
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 500 });

  return NextResponse.json({ code, email: user.email, expiresAt, ttlMinutes: TTL_MIN });
}

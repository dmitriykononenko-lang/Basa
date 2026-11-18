// Общие помощники публичных роутов /api/intake/* (только сервер).
import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Анонимный клиент без сессии: публичные RPC работают только по токену.
export function anonClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Сведения об устройстве для журнала: укороченный хеш IP и User-Agent (без самого IP).
export function clientInfo(request: Request): { ip_hash: string; ua: string } {
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || request.headers.get("x-real-ip") || "";
  return {
    ip_hash: ip ? createHash("sha256").update(`ko-intake:${ip}`).digest("hex").slice(0, 16) : "",
    ua: (request.headers.get("user-agent") ?? "").slice(0, 160),
  };
}

export function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

// Хелперы синхронизации Базы знаний с Obsidian (markdown ↔ HTML) и токен-авторизация.
import { createHash, randomBytes } from "crypto";
import { NodeHtmlMarkdown } from "node-html-markdown";
import { marked } from "marked";
import { sanitizeRichHtml } from "@/lib/sanitize";
import type { SupabaseClient } from "@supabase/supabase-js";

export function htmlToMarkdown(html: string | null | undefined): string {
  if (!html) return "";
  return NodeHtmlMarkdown.translate(html);
}

export function markdownToHtml(md: string | null | undefined): string {
  if (!md) return "";
  const raw = marked.parse(md, { async: false }) as string;
  return sanitizeRichHtml(raw);
}

export function newSyncToken(): { token: string; hash: string } {
  const token = "obsd_" + randomBytes(24).toString("hex");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

// Достаём Bearer-токен из заголовка запроса.
export function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// По токену находим команду (через admin-клиент, обходя RLS).
export async function teamByToken(admin: SupabaseClient, token: string | null): Promise<string | null> {
  if (!token) return null;
  const { data } = await admin
    .from("obsidian_connection")
    .select("team_id")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  return (data?.team_id as string) ?? null;
}

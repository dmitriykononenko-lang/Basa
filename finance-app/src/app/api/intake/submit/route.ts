import { z } from "zod";
import { parseJson } from "@/lib/api-validation";
import { anonClient, clientInfo, noStore, TOKEN_RE } from "@/lib/intake-public";
import { notifyIntakeEvent } from "@/lib/intake-notify";
import { appBaseUrl } from "@/lib/intake-config";

export const dynamic = "force-dynamic";

// Публично: клиент отправил данные. Сервер получает ТОЛЬКО шифртекст
// (зашифрован в браузере открытым ключом команды) и две открытые отметки.
export async function POST(request: Request) {
  const p = await parseJson(
    request,
    z.object({
      token: z.string().max(64),
      payload: z.string().min(100).max(24000),
      user_added: z.boolean(),
      fallback: z.boolean(),
    }),
  );
  if (!p.ok) return p.res;
  if (!TOKEN_RE.test(p.data.token)) return noStore({ status: "invalid" });

  const { data, error } = await anonClient().rpc("vault_intake_submit", {
    _token: p.data.token,
    _payload: p.data.payload,
    _user_added: p.data.user_added,
    _fallback: p.data.fallback,
    _client: clientInfo(request),
  });
  if (error) return noStore({ status: "error" }, 500);
  const res = (data ?? { status: "invalid" }) as Record<string, unknown>;
  if (res.status === "ok" && res.request_id) {
    // Ссылка в уведомлении — на сам Basa, а не на страницу клиента.
    await notifyIntakeEvent(String(res.request_id), "submit", appBaseUrl(new URL(request.url).origin)).catch(() => {});
  }
  return noStore({ status: res.status });
}

import { z } from "zod";
import { parseJson } from "@/lib/api-validation";
import { anonClient, clientInfo, noStore, TOKEN_RE } from "@/lib/intake-public";
import { appBaseUrl, intakeAgencyConfig } from "@/lib/intake-config";
import { notifyIntakeEvent } from "@/lib/intake-notify";

export const dynamic = "force-dynamic";

// Публично: клиент открыл ссылку. Токен приходит в теле (в адресе он во фрагменте #).
export async function POST(request: Request) {
  const p = await parseJson(request, z.object({ token: z.string().max(64) }));
  if (!p.ok) return p.res;
  if (!TOKEN_RE.test(p.data.token)) return noStore({ status: "invalid" });

  const { data, error } = await anonClient().rpc("vault_intake_load", {
    _token: p.data.token,
    _client: clientInfo(request),
  });
  if (error) return noStore({ status: "error" }, 500);
  const res = (data ?? { status: "invalid" }) as Record<string, unknown>;
  if (res.status !== "ok") return noStore({ status: res.status });

  if (res.first_open === true) {
    await notifyIntakeEvent(String(res.request_id), "open", appBaseUrl(new URL(request.url).origin)).catch(() => {});
  }
  const { first_open: _drop, ...pub } = res;
  void _drop;
  return noStore({ ...pub, agency: intakeAgencyConfig() });
}

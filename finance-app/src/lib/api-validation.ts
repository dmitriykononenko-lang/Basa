// Строгая валидация тела API-запросов через Zod. Возвращает либо
// { ok: true, data } с типизированными данными, либо { ok: false, res } с
// готовым 400-ответом. Идея из «contracts»-подхода — не доверять телу запроса.
import { NextResponse } from "next/server";
import type { z } from "zod";

export async function parseJson<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, res: NextResponse.json({ error: "bad_json" }, { status: 400 }) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      res: NextResponse.json({ error: "invalid_input", details: parsed.error.flatten().fieldErrors }, { status: 400 }),
    };
  }
  return { ok: true, data: parsed.data };
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { decryptSecret } from "@/lib/crypto";
import { getAccounts, fetchOperations } from "@/lib/tochka";

// Импорт операций из Точки за период в транзакции (с дедупом и пометкой переводов).
export async function POST(request: Request) {
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Нет команды" }, { status: 400 });
  if (!canEditFinance(current.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  let body: { tochkaAccountId?: string; from?: string; to?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 }); }
  const from = body.from?.slice(0, 10);
  const to = body.to?.slice(0, 10);
  if (!from || !to) return NextResponse.json({ error: "Укажите период" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { data: conn } = await supabase
    .from("bank_connections")
    .select("token_cipher, api_version, default_account_id, default_income_category_id, default_expense_category_id")
    .eq("team_id", current.team.id)
    .eq("provider", "tochka")
    .maybeSingle();
  if (!conn) return NextResponse.json({ error: "Точка не подключена" }, { status: 404 });

  let token: string;
  try { token = decryptSecret(conn.token_cipher); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка токена" }, { status: 500 }); }

  // Свои счета — для определения переводов между ними.
  let ownNumbers: Set<string>;
  let accountId: string;
  try {
    const accounts = await getAccounts({ token, apiVersion: conn.api_version });
    if (accounts.length === 0) return NextResponse.json({ error: "У токена нет доступных счетов" }, { status: 502 });
    ownNumbers = new Set(accounts.map((a) => a.accountNumber).filter(Boolean) as string[]);
    accountId = body.tochkaAccountId || accounts[0].accountId;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка счетов" }, { status: 502 });
  }

  let ops;
  try { ops = await fetchOperations({ token, apiVersion: conn.api_version, accountId, from, to }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка выписки" }, { status: 502 }); }

  // Дедуп внутри выписки + против уже импортированного.
  const byId = new Map(ops.filter((o) => o.amountMinor > 0).map((o) => [o.transactionId, o]));
  const ids = [...byId.keys()];
  if (ids.length === 0) {
    await supabase.from("bank_connections").update({ last_synced_at: new Date().toISOString() }).eq("team_id", current.team.id).eq("provider", "tochka");
    return NextResponse.json({ ok: true, imported: 0, skipped: 0, transfers: 0, total: 0 });
  }

  const { data: existingRows } = await supabase
    .from("transactions")
    .select("external_id")
    .eq("team_id", current.team.id)
    .eq("source", "tochka")
    .in("external_id", ids);
  const existing = new Set((existingRows ?? []).map((r) => r.external_id));

  let transfers = 0;
  const rows = [...byId.values()]
    .filter((o) => !existing.has(o.transactionId))
    .map((o) => {
      const isTransfer = !!o.counterpartyAccount && ownNumbers.has(o.counterpartyAccount);
      if (isTransfer) transfers++;
      const type = isTransfer ? "transfer" : o.direction;
      const category_id = isTransfer ? null : type === "income" ? conn.default_income_category_id : conn.default_expense_category_id;
      const noteParts = [
        o.description,
        o.counterpartyName && `Контрагент: ${o.counterpartyName}`,
        o.counterpartyInn && `ИНН ${o.counterpartyInn}`,
        isTransfer && `Перевод между своими счетами (${o.counterpartyAccount})`,
      ].filter(Boolean);
      return {
        team_id: current.team.id,
        type,
        amount: o.amountMinor,
        currency: o.currency,
        account_id: conn.default_account_id,
        category_id,
        occurred_on: o.date,
        note: noteParts.join(" · ") || null,
        created_by: user.id,
        external_id: o.transactionId,
        source: "tochka",
      };
    });

  const skipped = byId.size - rows.length;
  if (rows.length === 0) {
    await supabase.from("bank_connections").update({ last_synced_at: new Date().toISOString() }).eq("team_id", current.team.id).eq("provider", "tochka");
    return NextResponse.json({ ok: true, imported: 0, skipped, transfers: 0, total: byId.size });
  }

  // Батч импорта — чтобы импорт можно было откатить целиком.
  const { data: batch, error: batchErr } = await supabase
    .from("import_batches")
    .insert({
      team_id: current.team.id,
      created_by: user.id,
      file_name: `Точка ${from} — ${to}`,
      account_id: conn.default_account_id,
      bank: "tochka",
      row_count: rows.length,
      status: "imported",
    })
    .select("id")
    .single();
  if (batchErr || !batch) return NextResponse.json({ error: batchErr?.message ?? "Ошибка батча" }, { status: 500 });

  const { error: insErr } = await supabase
    .from("transactions")
    .insert(rows.map((r) => ({ ...r, import_batch_id: batch.id })));
  if (insErr) {
    // Откатываем пустой/частичный батч.
    await supabase.from("import_batches").delete().eq("id", batch.id);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  await supabase.from("bank_connections").update({ last_synced_at: new Date().toISOString() }).eq("team_id", current.team.id).eq("provider", "tochka");

  return NextResponse.json({ ok: true, imported: rows.length, skipped, transfers, total: byId.size, batchId: batch.id });
}

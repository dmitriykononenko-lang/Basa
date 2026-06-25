import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { decryptSecret } from "@/lib/crypto";
import { getAccounts, fetchOperations, fetchStatementRaw } from "@/lib/tochka";

// Импорт операций из Точки за период в транзакции (с дедупом и пометкой переводов).
// ?debug=1 — вернуть сырые операции из выписки без вставки (для сверки полей).
export async function POST(request: Request) {
  const debug = new URL(request.url).searchParams.get("debug") === "1";
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
  let sourceNumber: string | null = null;
  try {
    const accounts = await getAccounts({ token, apiVersion: conn.api_version });
    if (accounts.length === 0) return NextResponse.json({ error: "У токена нет доступных счетов" }, { status: 502 });
    ownNumbers = new Set(accounts.map((a) => a.accountNumber).filter(Boolean) as string[]);
    accountId = body.tochkaAccountId || accounts[0].accountId;
    sourceNumber = accounts.find((a) => a.accountId === accountId)?.accountNumber ?? null;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка счетов" }, { status: 502 });
  }

  // Сопоставление счетов Точки со счетами Basa (номер → account_id Basa).
  const { data: linkRows } = await supabase
    .from("bank_account_links")
    .select("external_account, account_id")
    .eq("team_id", current.team.id)
    .eq("provider", "tochka");
  const acctMap = new Map<string, string>();
  for (const l of linkRows ?? []) if (l.account_id) acctMap.set(l.external_account, l.account_id);
  // Счёт Basa для импортируемой выписки: маппинг → иначе дефолтный.
  const targetAccountId = (sourceNumber && acctMap.get(sourceNumber)) || conn.default_account_id;

  if (debug) {
    try {
      const raw = await fetchStatementRaw({ token, apiVersion: conn.api_version, accountId, from, to });
      return NextResponse.json({ ok: true, raw });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка выписки" }, { status: 502 });
    }
  }

  let ops;
  try { ops = await fetchOperations({ token, apiVersion: conn.api_version, accountId, from, to }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка выписки" }, { status: 502 }); }

  // Перевод между своими счетами учитываем один раз — только исходящую (Debit) ногу.
  // Входящая нога во встречной выписке пропускается, чтобы не задвоить перевод.
  const isInternal = (o: { counterpartyAccount: string | null }) => !!o.counterpartyAccount && ownNumbers.has(o.counterpartyAccount);
  const keep = ops.filter((o) => o.amountMinor > 0 && !(isInternal(o) && o.direction === "income"));

  // Дедуп внутри выписки + против уже импортированного.
  const byId = new Map(keep.map((o) => [o.transactionId, o]));
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

  const fresh = [...byId.values()].filter((o) => !existing.has(o.transactionId));

  // ── Контрагенты: матчим по ИНН, иначе по имени; недостающих создаём ──────────
  const { data: cpRows } = await supabase
    .from("counterparties")
    .select("id, name, inn")
    .eq("team_id", current.team.id);
  const cpByInn = new Map<string, string>();
  const cpByName = new Map<string, string>();
  for (const c of cpRows ?? []) {
    if (c.inn) cpByInn.set(String(c.inn).trim(), c.id);
    if (c.name) cpByName.set(c.name.trim().toLowerCase(), c.id);
  }
  const resolveCp = (o: { counterpartyName: string | null; counterpartyInn: string | null }): string | null => {
    if (o.counterpartyInn && cpByInn.has(o.counterpartyInn.trim())) return cpByInn.get(o.counterpartyInn.trim())!;
    if (o.counterpartyName && cpByName.has(o.counterpartyName.trim().toLowerCase())) return cpByName.get(o.counterpartyName.trim().toLowerCase())!;
    return null;
  };

  // Уникальные новые контрагенты (которых нет в справочнике).
  const toCreate = new Map<string, { name: string; inn: string | null; kpp: string | null; kind: string }>();
  for (const o of fresh) {
    if (!o.counterpartyName && !o.counterpartyInn) continue;
    if (resolveCp(o)) continue;
    const key = o.counterpartyInn?.trim() || o.counterpartyName!.trim().toLowerCase();
    if (toCreate.has(key)) continue;
    const isTransfer = !!o.counterpartyAccount && ownNumbers.has(o.counterpartyAccount);
    const kind = isTransfer ? "other" : o.direction === "income" ? "client" : "supplier";
    toCreate.set(key, { name: o.counterpartyName?.trim() || `ИНН ${o.counterpartyInn}`, inn: o.counterpartyInn?.trim() || null, kpp: o.counterpartyKpp, kind });
  }
  if (toCreate.size > 0) {
    const { data: created } = await supabase
      .from("counterparties")
      .insert([...toCreate.values()].map((c) => ({ team_id: current.team.id, name: c.name, inn: c.inn, kpp: c.kpp, kind: c.kind })))
      .select("id, name, inn");
    for (const c of created ?? []) {
      if (c.inn) cpByInn.set(String(c.inn).trim(), c.id);
      if (c.name) cpByName.set(c.name.trim().toLowerCase(), c.id);
    }
  }

  let transfers = 0;
  const rows = fresh.map((o) => {
    const isTransfer = !!o.counterpartyAccount && ownNumbers.has(o.counterpartyAccount);
    if (isTransfer) transfers++;
    const type = isTransfer ? "transfer" : o.direction;
    const category_id = isTransfer ? null : type === "income" ? conn.default_income_category_id : conn.default_expense_category_id;
    // Второй конец перевода — счёт Basa, сопоставленный со счётом-получателем.
    const transfer_account_id = isTransfer ? (o.counterpartyAccount && acctMap.get(o.counterpartyAccount)) || null : null;
    const noteParts = [
      o.description,
      o.docNumber && `${o.docType ?? "Документ"} №${o.docNumber}`,
      isTransfer && !transfer_account_id && `Перевод между своими счетами (${o.counterpartyAccount})`,
    ].filter(Boolean);
    return {
      team_id: current.team.id,
      type,
      amount: o.amountMinor,
      currency: o.currency,
      account_id: targetAccountId,
      transfer_account_id,
      category_id,
      counterparty_id: resolveCp(o),
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
      account_id: targetAccountId,
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

  return NextResponse.json({ ok: true, imported: rows.length, skipped, transfers, counterparties: toCreate.size, total: byId.size, batchId: batch.id });
}

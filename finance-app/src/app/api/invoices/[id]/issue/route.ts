import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { decryptSecret } from "@/lib/crypto";
import { getAccounts, createInvoice, buildBillBody, type TochkaInvoicePayload, type TochkaVat } from "@/lib/tochka";

// Выставить рублёвый счёт в Точке (invoice-API). ?debug=1 — вернуть собранное тело
// запроса БЕЗ отправки (для сверки полей на живом токене), иначе — отправить и
// сохранить documentId. Крипта (не RUB) в Точку не выставляется.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const debug = new URL(request.url).searchParams.get("debug") === "1";
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Нет команды" }, { status: 400 });
  if (!canEditFinance(current.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  const supabase = await createClient();
  const teamId = current.team.id;

  const { data: inv } = await supabase
    .from("invoices")
    .select("id, currency, buyer_name, buyer_inn, buyer_kpp, purpose, number, payment_expiry_date, tochka_document_id")
    .eq("id", id).eq("team_id", teamId).maybeSingle();
  if (!inv) return NextResponse.json({ error: "Инвойс не найден" }, { status: 404 });
  if (inv.currency !== "RUB") return NextResponse.json({ error: "В Точке выставляются только рублёвые счета" }, { status: 400 });
  if (inv.tochka_document_id) return NextResponse.json({ error: "Счёт уже выставлен в Точке" }, { status: 400 });
  if (!inv.buyer_inn) return NextResponse.json({ error: "У плательщика не указан ИНН — он нужен для счёта в Точке" }, { status: 400 });

  const { data: items } = await supabase
    .from("invoice_items").select("name, quantity, unit, price, vat_rate").eq("invoice_id", id).order("sort");
  if (!items || items.length === 0) return NextResponse.json({ error: "В счёте нет позиций" }, { status: 400 });

  const { data: conn } = await supabase
    .from("bank_connections")
    .select("token_cipher, api_version, customer_code, tax_system_code")
    .eq("team_id", teamId).eq("provider", "tochka").maybeSingle();
  if (!conn) return NextResponse.json({ error: "Точка не подключена" }, { status: 404 });
  if (!conn.customer_code) return NextResponse.json({ error: "Не задан customerCode Точки (укажите в подключении банка)" }, { status: 400 });

  let token: string;
  try { token = decryptSecret(conn.token_cipher); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка токена" }, { status: 500 }); }

  // Счёт Точки для выставления (первый доступный по токену).
  let accountId: string;
  try {
    const accounts = await getAccounts({ token, apiVersion: conn.api_version });
    if (accounts.length === 0) return NextResponse.json({ error: "У токена нет доступных счетов" }, { status: 502 });
    accountId = accounts[0].accountId;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка счетов" }, { status: 502 });
  }

  const payload: TochkaInvoicePayload = {
    accountId,
    customerCode: conn.customer_code,
    purpose: inv.purpose || (inv.number ? `Оплата по счёту № ${inv.number}` : "Оплата по счёту"),
    paymentExpiryDate: inv.payment_expiry_date,
    buyer: { name: inv.buyer_name, inn: inv.buyer_inn, kpp: inv.buyer_kpp || null, taxSystemCode: conn.tax_system_code ?? null },
    items: items.map((it) => ({
      name: it.name, quantity: Number(it.quantity), unitPriceMinor: it.price as number,
      vat: (it.vat_rate as TochkaVat), unit: it.unit as string,
    })),
  };

  // Debug: показать тело без отправки в Точку.
  if (debug) return NextResponse.json({ ok: true, debug: true, body: buildBillBody(payload) });

  let documentId: string | null;
  try {
    const res = await createInvoice({ token }, payload);
    documentId = res.documentId;
    if (!documentId) return NextResponse.json({ error: "Точка не вернула documentId", raw: res.raw }, { status: 502 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка выставления в Точке" }, { status: 502 });
  }

  const { error } = await supabase
    .from("invoices")
    .update({ tochka_document_id: documentId, tochka_account_id: accountId, status: "payment_waiting" })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });

  return NextResponse.json({ ok: true, documentId });
}

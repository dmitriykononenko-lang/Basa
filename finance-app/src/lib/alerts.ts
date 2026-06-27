// Общая логика вычисления алертов команды — переиспользуется кроном уведомлений.
// Пороги и формулы повторяют дашборд (src/app/(app)/dashboard/page.tsx): кассовый
// разрыв, просроченные обязательства, перерасход бюджета, нехватка на счёте под план,
// дедлайны обучения. Запускается с admin-клиентом (service_role, в обход RLS),
// поэтому фильтрация — явно по team_id.

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildRateMap, toBase, type RateMap } from "./fx";
import { fetchCbrRates } from "./cbr";
import { fetchAllRows } from "./supabase/paginate";
import { formatMoney } from "./format";
import { dueStatus, unitAncestors } from "./academy";

export type AlertType =
  | "cash_gap"
  | "debt_overdue"
  | "budget_over"
  | "transfer_short"
  | "training_due";

export type AlertSeverity = "info" | "warning" | "critical";

export type TeamAlert = {
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  body: string;
  link: string;
  dedupeKey: string;
  recipients: string[]; // user_id получателей
};

type Team = { id: string; name: string; base_currency: string };

const DAYMS = 86400000;

// Вычисляет активные алерты команды на дату `today` (YYYY-MM-DD).
export async function computeTeamAlerts(
  admin: SupabaseClient,
  team: Team,
  today: string,
): Promise<TeamAlert[]> {
  const base = team.base_currency;
  const now = new Date(today + "T00:00:00");
  const curY = now.getFullYear();
  const curM = now.getMonth();
  const yearStart = new Date(curY, 0, 1).toISOString().slice(0, 10);
  const FUT = 3; // месяцев прогноза вперёд (как на дашборде)

  // Получатели финансовых алертов — участники команды с правом редактирования финансов.
  const { data: members } = await admin
    .from("team_members")
    .select("user_id, role")
    .eq("team_id", team.id);
  const financeRecipients = ((members ?? []) as { user_id: string; role: string }[])
    .filter((m) => m.role === "owner" || m.role === "admin" || m.role === "manager")
    .map((m) => m.user_id);

  // Батч запросов финансового ядра.
  const [
    { data: accounts },
    { data: balances },
    { data: fxRows },
    cbr,
    { data: overdue },
    { data: budgets },
    { data: planTx },
    { data: futureObl },
  ] = await Promise.all([
    admin.from("accounts").select("id, name, currency").eq("team_id", team.id).eq("archived", false),
    admin.from("account_balances").select("account_id, currency, balance").eq("team_id", team.id),
    admin.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
    base === "RUB" ? fetchCbrRates() : Promise.resolve({ rates: {} as Record<string, number>, date: null }),
    admin.from("obligation_balances").select("outstanding, currency, due_date").eq("team_id", team.id).gt("outstanding", 0).lt("due_date", today),
    admin.from("budgets").select("amount, currency, period, period_start, category_id").eq("team_id", team.id),
    admin.from("transactions").select("type, amount, currency, occurred_on, account_id, transfer_account_id").eq("team_id", team.id).eq("status", "planned"),
    admin.from("obligation_balances").select("type, outstanding, currency, due_date").eq("team_id", team.id).gt("outstanding", 0).gte("due_date", today),
  ]);

  // Курсы валют (ручные + ЦБ для рублёвой базы).
  const rates: RateMap = buildRateMap((fxRows ?? []) as { currency: string; rate: number; rate_date: string }[], base);
  for (const [cur, r] of Object.entries(cbr.rates)) {
    if (rates[cur] === undefined) rates[cur] = r;
  }

  const balanceList = (balances ?? []) as { account_id: string; currency: string; balance: number }[];
  const currentBalance = balanceList.reduce((s, b) => s + toBase(b.balance, b.currency, rates), 0);
  const balanceMap = new Map(balanceList.map((b) => [b.account_id, b.balance]));

  const alerts: TeamAlert[] = [];

  // ── 1. Кассовый разрыв (дневной прогноз остатка на +3 месяца) ──
  const dayOf = (s: string) => Math.floor(new Date(s + "T00:00:00").getTime() / DAYMS);
  const isoOf = (d: number) => new Date(d * DAYMS).toISOString().slice(0, 10);
  const tDay = dayOf(today);
  const evByDay = new Map<number, number>();
  const pushEvDay = (dateStr: string, delta: number) => {
    const d = Math.max(dayOf(dateStr), tDay);
    evByDay.set(d, (evByDay.get(d) ?? 0) + delta);
  };
  for (const t of (planTx ?? []) as { type: string; amount: number; currency: string; occurred_on: string }[]) {
    if (t.type === "transfer") continue;
    const v = toBase(t.amount, t.currency, rates);
    pushEvDay(t.occurred_on, t.type === "income" ? v : -v);
  }
  for (const o of (futureObl ?? []) as { type: string; outstanding: number; currency: string; due_date: string }[]) {
    const v = toBase(o.outstanding, o.currency, rates);
    pushEvDay(o.due_date, o.type === "receivable" ? v : -v);
  }
  const evDays = [...evByDay.keys()].sort((a, b) => a - b);
  let run = currentBalance;
  let gap: { date: string; value: number } | null = null;
  for (const d of evDays) {
    run += evByDay.get(d)!;
    if (run < 0 && (!gap || run < gap.value)) gap = { date: isoOf(d), value: run };
  }
  if (gap) {
    alerts.push({
      type: "cash_gap",
      severity: "critical",
      title: "Прогнозируется кассовый разрыв",
      body: `К ${formatRu(gap.date)} прогнозный остаток опускается до ${formatMoney(gap.value, base)}. Запланируйте поступления или перенесите выплаты.`,
      link: "/dashboard",
      dedupeKey: "cash_gap",
      recipients: financeRecipients,
    });
  }

  // ── 2. Просроченные обязательства ──
  const overdueRows = (overdue ?? []) as { outstanding: number; currency: string; due_date: string }[];
  if (overdueRows.length > 0) {
    const amount = overdueRows.reduce((s, o) => s + toBase(o.outstanding, o.currency, rates), 0);
    alerts.push({
      type: "debt_overdue",
      severity: "warning",
      title: `Просрочено обязательств: ${overdueRows.length}`,
      body: `Сумма просрочки — ${formatMoney(amount, base)}. Проверьте раздел «Долги».`,
      link: "/debts",
      dedupeKey: "debt_overdue",
      recipients: financeRecipients,
    });
  }

  // ── 3. Перерасход бюджета (по статьям) ──
  const budgetRows = (budgets ?? []) as { amount: number; currency: string; period: string; period_start: string; category_id: string | null }[];
  if (budgetRows.length > 0) {
    // Расходы (факт) за год — постранично.
    const yearExp = await fetchAllRows<{ category_id: string | null; amount: number; currency: string; occurred_on: string }>((from, to) =>
      admin.from("transactions").select("category_id, amount, currency, occurred_on").eq("team_id", team.id).eq("type", "expense").eq("status", "actual").gte("occurred_on", yearStart).order("occurred_on", { ascending: true }).range(from, to),
    );
    const { data: catRows } = await admin.from("categories").select("id, name").eq("team_id", team.id);
    const catName = new Map(((catRows ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
    for (const b of budgetRows) {
      const start = b.period_start;
      const end = new Date(b.period_start);
      if (b.period === "year") end.setFullYear(end.getFullYear() + 1);
      else if (b.period === "quarter") end.setMonth(end.getMonth() + 3);
      else end.setMonth(end.getMonth() + 1);
      const endStr = end.toISOString().slice(0, 10);
      let spent = 0;
      for (const t of yearExp) {
        if (t.category_id === b.category_id && t.occurred_on >= start && t.occurred_on < endStr) {
          spent += toBase(t.amount, t.currency, rates);
        }
      }
      const limit = toBase(b.amount, b.currency, rates);
      if (spent > limit) {
        const name = (b.category_id && catName.get(b.category_id)) || "Без статьи";
        alerts.push({
          type: "budget_over",
          severity: "warning",
          title: `Превышен бюджет: ${name}`,
          body: `Потрачено ${formatMoney(spent, base)} из ${formatMoney(limit, base)}.`,
          link: "/budgets",
          dedupeKey: `budget_over:${b.category_id ?? "none"}`,
          recipients: financeRecipients,
        });
      }
    }
  }

  // ── 4. Нехватка на счёте под план (per-account проекция min<0) ──
  type PlanEv = { occurred_on: string; type: string; amount: number; currency: string; account_id: string | null; transfer_account_id: string | null };
  const evByAcc = new Map<string, { date: string; delta: number }[]>();
  const pushEv = (accId: string | null, date: string, delta: number) => {
    if (!accId) return;
    const arr = evByAcc.get(accId) ?? [];
    arr.push({ date, delta });
    evByAcc.set(accId, arr);
  };
  for (const t of (planTx ?? []) as PlanEv[]) {
    const v = toBase(t.amount, t.currency, rates);
    const dt = t.occurred_on < today ? today : t.occurred_on;
    if (t.type === "income") pushEv(t.account_id, dt, v);
    else if (t.type === "expense") pushEv(t.account_id, dt, -v);
    else if (t.type === "transfer") { pushEv(t.account_id, dt, -v); pushEv(t.transfer_account_id, dt, v); }
  }
  for (const a of (accounts ?? []) as { id: string; name: string; currency: string }[]) {
    const startBal = toBase(balanceMap.get(a.id) ?? 0, a.currency, rates);
    const byDate = new Map<string, number>();
    for (const e of evByAcc.get(a.id) ?? []) byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.delta);
    let acc = startBal, min = startBal, minDate: string | null = null;
    for (const d of [...byDate.keys()].sort()) { acc += byDate.get(d)!; if (acc < min) { min = acc; minDate = d; } }
    if (min < 0) {
      alerts.push({
        type: "transfer_short",
        severity: "warning",
        title: `Нехватка на счёте «${a.name}»`,
        body: `Ожидается дефицит ${formatMoney(-min, base)}${minDate ? ` к ${formatRu(minDate)}` : ""}. Запланируйте перевод.`,
        link: "/transactions",
        dedupeKey: `transfer_short:${a.id}`,
        recipients: financeRecipients,
      });
    }
  }

  // ── 5. Дедлайны обучения (per-user) ──
  const [{ data: prog }, { data: assigns }, { data: cps }, { data: units }, { data: courses }] = await Promise.all([
    admin.from("academy_progress").select("course_id, user_id, status").eq("team_id", team.id),
    admin.from("academy_assignments").select("course_id, assignee_type, department_id, user_id, due_date").eq("team_id", team.id),
    admin.from("counterparties").select("user_id, unit_id").eq("team_id", team.id).eq("archived", false).contains("kinds", ["employee"]),
    admin.from("kb_departments").select("id, parent_id").eq("team_id", team.id),
    admin.from("academy_courses").select("id, title").eq("team_id", team.id),
  ]);
  const progRows = (prog ?? []) as { course_id: string; user_id: string; status: string }[];
  if (progRows.length > 0) {
    const courseTitle = new Map(((courses ?? []) as { id: string; title: string }[]).map((c) => [c.id, c.title]));
    const parentOf = new Map(((units ?? []) as { id: string; parent_id: string | null }[]).map((u) => [u.id, u.parent_id]));
    const unitOfUser = new Map<string, string | null>();
    for (const c of (cps ?? []) as { user_id: string | null; unit_id: string | null }[]) {
      if (c.user_id) unitOfUser.set(c.user_id, c.unit_id);
    }
    // done/total по (user, course)
    const byUserCourse = new Map<string, { done: number; total: number }>();
    for (const p of progRows) {
      const k = `${p.user_id}::${p.course_id}`;
      const e = byUserCourse.get(k) ?? { done: 0, total: 0 };
      e.total += 1;
      if (p.status === "done") e.done += 1;
      byUserCourse.set(k, e);
    }
    const assignRows = (assigns ?? []) as { course_id: string; assignee_type: string; department_id: string | null; user_id: string | null; due_date: string | null }[];
    for (const [k, e] of byUserCourse) {
      const allDone = e.total > 0 && e.done === e.total;
      if (allDone) continue;
      const [uid, courseId] = k.split("::");
      const myUnits = unitAncestors(unitOfUser.get(uid) ?? null, parentOf);
      // ближайший применимый дедлайн
      let due: string | null = null;
      for (const a of assignRows) {
        if (a.course_id !== courseId || !a.due_date) continue;
        const applies = (a.assignee_type === "user" && a.user_id === uid) || (a.assignee_type === "department" && a.department_id && myUnits.has(a.department_id));
        if (applies && (!due || a.due_date < due)) due = a.due_date;
      }
      const ds = dueStatus(due, allDone, today);
      if (ds === "overdue" || ds === "soon") {
        const title = courseTitle.get(courseId) ?? "Курс";
        alerts.push({
          type: "training_due",
          severity: ds === "overdue" ? "warning" : "info",
          title: ds === "overdue" ? `Просрочен курс: ${title}` : `Скоро срок курса: ${title}`,
          body: due ? `Срок прохождения — до ${formatRu(due)}. Пройдено ${e.done} из ${e.total}.` : "",
          link: `/academy/${courseId}`,
          dedupeKey: `training_due:${courseId}`,
          recipients: [uid],
        });
      }
    }
  }

  return alerts;
}

function formatRu(iso: string): string {
  const s = iso.length === 10 ? `${iso}T00:00:00` : iso;
  return new Date(s).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
}

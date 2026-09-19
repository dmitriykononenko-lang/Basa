// Настраиваемая видимость разделов по ролям.
// «Ресурс» = группа разделов. Владелец/админ задаёт, какие роли его видят.
// По умолчанию (нет правила) — видно всем участникам команды.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "./types";

export type VisResource = "balances" | "finance" | "metrics" | "learning" | "vault";

export const VIS_RESOURCES: { key: VisResource; label: string; desc: string }[] = [
  { key: "balances", label: "Остатки по счетам", desc: "Балансы на дашборде и странице «Счета»" },
  { key: "finance", label: "Финансы и аналитика", desc: "Контрагенты, проекты, бюджеты, зарплата, отчёты, долги" },
  { key: "metrics", label: "Показатели", desc: "Раздел «Показатели»" },
  { key: "learning", label: "Обучение", desc: "База знаний и Академия" },
  { key: "vault", label: "Пароли", desc: "Раздел «Пароли»" },
];

// Роли, которыми можно управлять в матрице (owner всегда видит всё).
export const CONFIGURABLE_ROLES: AppRole[] = ["admin", "manager", "employee", "viewer"];
export const ALL_ROLES: AppRole[] = ["owner", "admin", "manager", "employee", "viewer"];

// Шаблоны по ролям: resource → список ролей, которым видно.
export type VisibilityMap = Record<string, AppRole[]>;
// Индивидуальные переопределения сотрудника: resource → видно/нет.
export type MemberOverrides = Record<string, boolean>;

// Шаблоны видимости по ролям (team_visibility). Нет строки = видно всем.
export async function loadRoleTemplates(supabase: SupabaseClient, teamId: string): Promise<VisibilityMap> {
  const { data } = await supabase
    .from("team_visibility")
    .select("resource, allowed_roles")
    .eq("team_id", teamId);
  const map: VisibilityMap = {};
  for (const r of (data ?? []) as { resource: string; allowed_roles: AppRole[] }[]) {
    map[r.resource] = r.allowed_roles;
  }
  return map;
}

// Индивидуальные переопределения конкретного сотрудника (member_visibility).
export async function loadMemberOverrides(
  supabase: SupabaseClient,
  teamId: string,
  userId: string,
): Promise<MemberOverrides> {
  const { data } = await supabase
    .from("member_visibility")
    .select("resource, visible")
    .eq("team_id", teamId)
    .eq("user_id", userId);
  const map: MemberOverrides = {};
  for (const r of (data ?? []) as { resource: string; visible: boolean }[]) map[r.resource] = r.visible;
  return map;
}

// Обратная совместимость: прежнее имя.
export const loadVisibility = loadRoleTemplates;

// Итоговая видимость: owner → да; индивидуально → по роли-шаблону → по умолчанию.
export function canView(
  role: AppRole,
  resource: VisResource,
  templates: VisibilityMap,
  overrides: MemberOverrides = {},
): boolean {
  if (role === "owner") return true;
  if (resource in overrides) return overrides[resource];
  const allowed = templates[resource];
  if (!allowed) return true; // по умолчанию — видно
  return allowed.includes(role);
}

// Соответствие пунктов меню ресурсам (для скрытия в сайдбаре).
export const HREF_RESOURCE: Record<string, VisResource> = {
  "/metrics": "metrics",
  "/counterparties": "finance",
  "/agents": "finance",
  "/projects": "finance",
  "/licenses": "finance",
  "/budgets": "finance",
  "/payroll": "finance",
  "/reports/cashflow": "finance",
  "/reports/pnl": "finance",
  "/reports": "finance",
  "/reports/team": "finance",
  "/debts": "finance",
  "/calendar": "finance",
  "/recurring": "finance",
  "/knowledge-base": "learning",
  "/academy": "learning",
  "/vault": "vault",
};

// Список href'ов, которые надо скрыть для пользователя по итоговой видимости.
export function hiddenHrefs(role: AppRole, templates: VisibilityMap, overrides: MemberOverrides = {}): string[] {
  return Object.entries(HREF_RESOURCE)
    .filter(([, res]) => !canView(role, res, templates, overrides))
    .map(([href]) => href);
}

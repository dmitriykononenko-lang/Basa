export type AppRole = "owner" | "admin" | "manager" | "employee" | "viewer";

export const ROLE_LABELS: Record<AppRole, string> = {
  owner: "Владелец",
  admin: "Администратор",
  manager: "Менеджер",
  employee: "Сотрудник",
  viewer: "Наблюдатель",
};

export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  owner: "Полный доступ ко всему, включая управление другими владельцами и удаление команды.",
  admin: "Полный доступ к деньгам, проектам, отчётам и настройкам; управляет правами других (кроме владельцев).",
  manager: "Видит финансы, ведёт операции и проекты; без управления участниками команды.",
  employee: "Сотрудник/аналитик: видит сроки и мотивацию по проектам, финансы скрыты.",
  viewer: "Только просмотр, без изменений.",
};

export type Team = {
  id: string;
  name: string;
  base_currency: string;
  created_by: string | null;
  created_at: string;
};

export type TeamMembership = {
  team_id: string;
  user_id: string;
  role: AppRole;
  teams: Team;
};

export type Currency = {
  code: string;
  name: string;
  symbol: string | null;
  minor_unit: number;
};

export type TxType = "income" | "expense" | "transfer";
export type ObligationType = "receivable" | "payable";

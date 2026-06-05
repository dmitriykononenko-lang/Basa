export type AppRole = "owner" | "admin" | "manager" | "employee" | "viewer";

export const ROLE_LABELS: Record<AppRole, string> = {
  owner: "Владелец",
  admin: "Администратор",
  manager: "Менеджер",
  employee: "Сотрудник",
  viewer: "Наблюдатель",
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

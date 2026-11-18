// Типы и подписи для модуля «Пароли».

export type VaultEntry = {
  id: string;
  title: string;
  login: string;
  url: string;
  note: string;
  group_name: string;
  project_id: string | null;
  project_name: string | null;
  counterparty_id?: string | null;
  counterparty_name?: string | null;
  has_secret: boolean;
  can_reveal: boolean;
  can_manage: boolean;
  created_by: string | null;
  updated_at: string;
};

export type VaultProject = { id: string; name: string };

export type VaultSubjectType = "user" | "unit";

export type VaultGrant = {
  id: string;
  entry_id: string;
  subject_type: VaultSubjectType;
  user_id: string | null;
  unit_id: string | null;
};

export type VaultAction =
  | "reveal" | "create" | "update" | "delete" | "grant" | "revoke"
  | "intake_key" | "intake_create" | "intake_open" | "intake_submit" | "intake_revoke" | "intake_expire" | "intake_accept";

export type VaultLogRow = {
  id: string;
  entry_id: string | null;
  user_id: string | null;
  action: VaultAction;
  details: Record<string, unknown> | null;
  created_at: string;
};

export const VAULT_ACTION_LABELS: Record<VaultAction, string> = {
  reveal: "Показ пароля",
  create: "Создана",
  update: "Изменена",
  delete: "Удалена",
  grant: "Выдан доступ",
  revoke: "Снят доступ",
  intake_key: "Ключ команды создан",
  intake_create: "Запрос клиенту создан",
  intake_open: "Клиент открыл ссылку",
  intake_submit: "Клиент передал доступ",
  intake_revoke: "Запрос отозван",
  intake_expire: "Запрос истёк",
  intake_accept: "Принято от клиента",
};

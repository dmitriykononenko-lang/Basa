// Типы и подписи для модуля «Пароли».

export type VaultEntry = {
  id: string;
  title: string;
  login: string;
  url: string;
  note: string;
  created_by: string | null;
  updated_at: string;
};

export type VaultSubjectType = "user" | "unit";

export type VaultGrant = {
  id: string;
  entry_id: string;
  subject_type: VaultSubjectType;
  user_id: string | null;
  unit_id: string | null;
};

export type VaultAction = "reveal" | "create" | "update" | "delete" | "grant" | "revoke";

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
};

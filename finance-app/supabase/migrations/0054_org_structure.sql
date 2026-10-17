-- ============================================================
-- 0054_org_structure: оргструктура (дерево узлов) на базе kb_departments
-- + связь сотрудника (counterparties) с узлом и с учёткой (auth.users).
-- Иерархия узлов: департамент → отдел → направление/команда →
-- должность; у узла есть руководитель, «Результат» (ЦКП) и «Функции».
-- ============================================================

-- Узлы оргструктуры = kb_departments (без переименования; уже дерево по parent_id)
alter table public.kb_departments
  add column if not exists unit_type text not null default 'department'
    check (unit_type in ('department','division','team','position')),
  add column if not exists result_text text,
  add column if not exists functions_text text,
  add column if not exists head_counterparty_id uuid references public.counterparties (id) on delete set null,
  add column if not exists sort int not null default 0;

-- Сотрудник ↔ узел оргструктуры и ↔ учётка (доступ в систему)
alter table public.counterparties
  add column if not exists unit_id uuid references public.kb_departments (id) on delete set null,
  add column if not exists user_id uuid references auth.users (id) on delete set null;

create index if not exists counterparties_unit_idx on public.counterparties (unit_id);
create index if not exists counterparties_user_idx on public.counterparties (user_id);

-- один пользователь — максимум один сотрудник в команде
create unique index if not exists counterparties_team_user_uniq
  on public.counterparties (team_id, user_id) where user_id is not null;

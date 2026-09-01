-- ============================================================
-- 0083_org_unit_share_icon: доля владения (%) и иконка узла оргструктуры.
-- share_percent — доля владения для собственников (бейдж у имени на карточке).
-- icon — эмодзи-иконка узла (перед названием).
-- ============================================================

alter table public.kb_departments
  add column if not exists share_percent integer,
  add column if not exists icon text;

comment on column public.kb_departments.share_percent is 'Доля владения, % (для собственников) — бейдж у имени.';
comment on column public.kb_departments.icon is 'Иконка узла (эмодзи) — перед названием.';

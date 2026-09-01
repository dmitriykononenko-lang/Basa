-- ============================================================
-- 0007_attachments: чеки и вложения к операциям (Supabase Storage)
-- ============================================================

-- Приватный бакет для чеков
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- Метаданные вложений
create table if not exists public.attachments (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references public.teams (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  storage_path   text not null,
  file_name      text not null,
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now()
);
create index if not exists attachments_tx_idx on public.attachments (transaction_id);

alter table public.attachments enable row level security;

drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments for select
  using (public.is_team_member(team_id));

drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments for insert
  with check (public.can_write_tx(team_id) and created_by = auth.uid());

drop policy if exists attachments_delete on public.attachments;
create policy attachments_delete on public.attachments for delete
  using (public.can_edit_finance(team_id) or created_by = auth.uid());

-- ---------- Политики на storage.objects (путь: {team_id}/{tx_id}/{file}) ----------
drop policy if exists receipts_select on storage.objects;
create policy receipts_select on storage.objects for select to authenticated
  using (
    bucket_id = 'receipts'
    and public.is_team_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists receipts_insert on storage.objects;
create policy receipts_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and public.can_write_tx(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists receipts_delete on storage.objects;
create policy receipts_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'receipts'
    and public.is_team_member(((storage.foldername(name))[1])::uuid)
  );

-- ============================================================
-- 0033_agent_contract: реквизиты договора у контрагента (для агентов/отчётов)
-- ============================================================
alter table public.counterparties add column if not exists contract_number text;
alter table public.counterparties add column if not exists contract_date date;

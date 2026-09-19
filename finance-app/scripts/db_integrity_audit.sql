-- db_integrity_audit.sql — READ ONLY data-integrity & tenant-isolation checker for Basa.
-- Safe to run against production: performs only SELECT. Fixes NOTHING.
-- Result per check: PASS (0 bad rows) / FAIL (bad rows found). Investigate every FAIL.
-- Run in Supabase SQL editor or: psql "$DATABASE_URL" -f scripts/db_integrity_audit.sql
--
-- Covers: cross-tenant relations, orphans/broken FKs, team_id mismatches on child rows.
-- Extend the VALUES list as the schema grows.

with checks(name, bad) as (
  values
  -- cross-tenant relation leaks (child.team_id / parent.team_id must match)
  ('tx.account cross-team',              (select count(*) from transactions t join accounts a on a.id=t.account_id where a.team_id<>t.team_id)),
  ('tx.transfer_account cross-team',     (select count(*) from transactions t join accounts a on a.id=t.transfer_account_id where a.team_id<>t.team_id)),
  ('tx.category cross-team',             (select count(*) from transactions t join categories c on c.id=t.category_id where c.team_id<>t.team_id)),
  ('tx.project cross-team',              (select count(*) from transactions t join projects p on p.id=t.project_id where p.team_id<>t.team_id)),
  ('tx.counterparty cross-team',         (select count(*) from transactions t join counterparties cp on cp.id=t.counterparty_id where cp.team_id<>t.team_id)),
  ('invoice_items team<>invoice',        (select count(*) from invoice_items it join invoices i on i.id=it.invoice_id where it.team_id<>i.team_id)),
  ('invoices.counterparty cross-team',   (select count(*) from invoices i join counterparties cp on cp.id=i.counterparty_id where cp.team_id<>i.team_id)),
  ('invoices.project cross-team',        (select count(*) from invoices i join projects p on p.id=i.project_id where p.team_id<>i.team_id)),
  ('obligations.counterparty cross-team',(select count(*) from obligations o join counterparties cp on cp.id=o.counterparty_id where cp.team_id<>o.team_id)),
  ('oblig_payments tx cross-team',       (select count(*) from obligation_payments op join obligations o on o.id=op.obligation_id join transactions t on t.id=op.transaction_id where t.team_id<>o.team_id)),
  ('counterparty.unit cross-team',       (select count(*) from counterparties cp join kb_departments d on d.id=cp.unit_id where d.team_id<>cp.team_id)),
  ('metrics.unit cross-team',            (select count(*) from metrics m join kb_departments d on d.id=m.unit_id where d.team_id<>m.team_id)),
  ('bank_account_links.acct cross-team', (select count(*) from bank_account_links l join accounts a on a.id=l.account_id where a.team_id<>l.team_id)),
  -- orphans / broken references
  ('tx.account orphan',                  (select count(*) from transactions t where t.account_id is not null and not exists(select 1 from accounts a where a.id=t.account_id))),
  ('invoice_items orphan',               (select count(*) from invoice_items it where not exists(select 1 from invoices i where i.id=it.invoice_id))),
  ('oblig_payments oblig orphan',        (select count(*) from obligation_payments op where not exists(select 1 from obligations o where o.id=op.obligation_id))),
  ('oblig_payments tx orphan',           (select count(*) from obligation_payments op where op.transaction_id is not null and not exists(select 1 from transactions t where t.id=op.transaction_id))),
  ('team_members orphan team',           (select count(*) from team_members tm where not exists(select 1 from teams t where t.id=tm.team_id))),
  -- duplicates that break invariants
  ('dup team_members(user,team)',        (select coalesce(sum(c-1),0) from (select count(*) c from team_members group by user_id, team_id having count(*)>1) x)),
  ('dup oblig_payment(tx,oblig)',        (select coalesce(sum(c-1),0) from (select count(*) c from obligation_payments where transaction_id is not null group by transaction_id, obligation_id having count(*)>1) x))
)
select name,
       bad,
       case when bad = 0 then 'PASS' else 'FAIL' end as result
from checks
order by (bad > 0) desc, name;

-- Optional: tables in public with RLS disabled (should be zero rows).
-- select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
--  where n.nspname='public' and c.relkind='r' and c.relrowsecurity=false;

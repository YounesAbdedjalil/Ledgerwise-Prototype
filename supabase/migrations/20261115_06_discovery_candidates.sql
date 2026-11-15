-- Ledgerwise prototype — migration 06 (discovery negative cache)
--
-- Remembers candidate websites that autonomous discovery has already judged
-- NOT to be a qualifying e-commerce prospect (service business, no storefront
-- evidence, no US evidence), so later runs spend their limited research and AI
-- budget on new sites instead of re-researching the same rejects.
--
-- Only judgements about the company are stored. Fetch and AI failures are
-- transient and are deliberately NOT remembered.
--
-- Safe to apply any time: the app works without it (it just loses the memory).
-- Run manually in the Supabase SQL Editor. Same authenticated-only policy
-- model as migration 01 (single-team prototype; see docs/SECURITY.md).

create table if not exists public.discovery_candidates (
  host         text primary key,
  company_name text,
  status       text not null default 'rejected'
               check (status in ('rejected')),
  stage        text not null,
  reason       text,
  query        text,
  checked_at   timestamptz not null default now(),
  checked_by   uuid
);

create index if not exists discovery_candidates_checked_at_idx
  on public.discovery_candidates (checked_at desc);

alter table public.discovery_candidates enable row level security;

drop policy if exists auth_select_discovery_candidates on public.discovery_candidates;
drop policy if exists auth_insert_discovery_candidates on public.discovery_candidates;
drop policy if exists auth_update_discovery_candidates on public.discovery_candidates;

create policy auth_select_discovery_candidates on public.discovery_candidates
  for select to authenticated using (true);
create policy auth_insert_discovery_candidates on public.discovery_candidates
  for insert to authenticated with check (true);
create policy auth_update_discovery_candidates on public.discovery_candidates
  for update to authenticated using (true) with check (true);

notify pgrst, 'reload schema';

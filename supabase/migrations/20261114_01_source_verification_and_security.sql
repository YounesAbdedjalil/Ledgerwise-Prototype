-- Ledgerwise prototype — migration 01
-- Source verification, RLS hardening, append-only protection, suppression RPCs.
--
-- IMPORTANT
-- 1. Export existing policies and constraints first. See docs/MIGRATION_INSTRUCTIONS.md.
-- 2. This migration replaces policies on the listed tables with authenticated-only
--    policies. It does NOT provide per-user or tenant isolation. It is for the
--    single-team prototype assumption described in docs/SECURITY.md.
-- 3. Run this file manually in the Supabase SQL Editor. It is not executed by the app.

-- ---------------------------------------------------------------------------
-- 1. Source verification columns and one-time backfill
-- ---------------------------------------------------------------------------

do $$
declare
  fresh_columns boolean;
begin
  select not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'company_sources'
      and column_name = 'verification_status'
  ) into fresh_columns;

  alter table public.company_sources
    add column if not exists imported_by uuid references public.users(id);
  alter table public.company_sources
    add column if not exists verification_status text not null default 'pending_review';
  alter table public.company_sources
    add column if not exists reviewed_by uuid references public.users(id);
  alter table public.company_sources
    add column if not exists reviewed_at timestamptz;
  alter table public.company_sources
    add column if not exists verification_note text;

  if fresh_columns then
    -- The old verified_by value was stamped automatically by the importer and
    -- cannot be treated as human verification. Preserve it as import attribution,
    -- then clear it and put every existing source back into the review queue.
    update public.company_sources
    set imported_by = verified_by,
        verified_by = null,
        verification_status = 'pending_review',
        reviewed_by = null,
        reviewed_at = null,
        verification_note = null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_sources_verification_status_check'
      and conrelid = 'public.company_sources'::regclass
  ) then
    alter table public.company_sources
      add constraint company_sources_verification_status_check
      check (verification_status in ('pending_review', 'verified', 'rejected'));
  end if;
end $$;

alter table public.conversations
  add column if not exists ai_processing_at timestamptz;

create index if not exists company_sources_company_id_idx
  on public.company_sources (company_id);
create index if not exists company_sources_verification_status_idx
  on public.company_sources (verification_status);
create index if not exists company_sources_company_verification_idx
  on public.company_sources (company_id, verification_status);
create index if not exists qualification_scores_company_id_idx
  on public.qualification_scores (company_id);
create index if not exists email_drafts_company_status_idx
  on public.email_drafts (company_id, status);
create index if not exists email_events_draft_created_idx
  on public.email_events (draft_id, created_at);
create index if not exists conversations_company_status_idx
  on public.conversations (company_id, status);
create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at);
create index if not exists audit_logs_entity_idx
  on public.audit_logs (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- 2. Suppression unique index
-- ---------------------------------------------------------------------------

-- A duplicate index on the same expression is harmless and keeps ON CONFLICT
-- (lower(email)) reliable even if an earlier index had a different name.
create unique index if not exists suppressed_contacts_email_lower_idx
  on public.suppressed_contacts (lower(email));

-- ---------------------------------------------------------------------------
-- 3. RLS replacement — authenticated-only single-team policies
-- ---------------------------------------------------------------------------

alter table public.companies enable row level security;
alter table public.company_sources enable row level security;
alter table public.qualification_scores enable row level security;
alter table public.email_drafts enable row level security;
alter table public.email_events enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.calendar_slots enable row level security;
alter table public.bookings enable row level security;
alter table public.suppressed_contacts enable row level security;
alter table public.audit_logs enable row level security;

do $$
declare
  r record;
begin
  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'companies',
        'company_sources',
        'qualification_scores',
        'email_drafts',
        'email_events',
        'conversations',
        'messages',
        'calendar_slots',
        'bookings',
        'suppressed_contacts',
        'audit_logs'
      ])
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Companies
create policy auth_select_companies on public.companies
  for select to authenticated using (true);
create policy auth_insert_companies on public.companies
  for insert to authenticated with check (true);
create policy auth_update_companies on public.companies
  for update to authenticated using (true) with check (true);

-- Company sources
create policy auth_select_company_sources on public.company_sources
  for select to authenticated using (true);
create policy auth_insert_company_sources on public.company_sources
  for insert to authenticated with check (true);
create policy auth_update_company_sources on public.company_sources
  for update to authenticated using (true) with check (true);

-- Qualification scores
create policy auth_select_qualification_scores on public.qualification_scores
  for select to authenticated using (true);
create policy auth_insert_qualification_scores on public.qualification_scores
  for insert to authenticated with check (true);
create policy auth_update_qualification_scores on public.qualification_scores
  for update to authenticated using (true) with check (true);

-- Email drafts
create policy auth_select_email_drafts on public.email_drafts
  for select to authenticated using (true);
create policy auth_insert_email_drafts on public.email_drafts
  for insert to authenticated with check (true);
create policy auth_update_email_drafts on public.email_drafts
  for update to authenticated using (true) with check (true);

-- Email events: append-only in normal operation
create policy auth_select_email_events on public.email_events
  for select to authenticated using (true);
create policy auth_insert_email_events on public.email_events
  for insert to authenticated with check (true);

-- Conversations
create policy auth_select_conversations on public.conversations
  for select to authenticated using (true);
create policy auth_insert_conversations on public.conversations
  for insert to authenticated with check (true);
create policy auth_update_conversations on public.conversations
  for update to authenticated using (true) with check (true);

-- Messages
create policy auth_select_messages on public.messages
  for select to authenticated using (true);
create policy auth_insert_messages on public.messages
  for insert to authenticated with check (true);
create policy auth_update_messages on public.messages
  for update to authenticated using (true) with check (true);

-- Calendar slots
create policy auth_select_calendar_slots on public.calendar_slots
  for select to authenticated using (true);
create policy auth_insert_calendar_slots on public.calendar_slots
  for insert to authenticated with check (true);
create policy auth_update_calendar_slots on public.calendar_slots
  for update to authenticated using (true) with check (true);
create policy auth_delete_calendar_slots on public.calendar_slots
  for delete to authenticated using (true);

-- Bookings: no direct delete; cancellation is the supported path
create policy auth_select_bookings on public.bookings
  for select to authenticated using (true);
create policy auth_insert_bookings on public.bookings
  for insert to authenticated with check (true);
create policy auth_update_bookings on public.bookings
  for update to authenticated using (true) with check (true);

-- Suppression: read and insert only
create policy auth_select_suppressed_contacts on public.suppressed_contacts
  for select to authenticated using (true);
create policy auth_insert_suppressed_contacts on public.suppressed_contacts
  for insert to authenticated with check (true);

-- Audit: read and insert only
create policy auth_select_audit_logs on public.audit_logs
  for select to authenticated using (true);
create policy auth_insert_audit_logs on public.audit_logs
  for insert to authenticated with check (true);

-- ---------------------------------------------------------------------------
-- 4. Append-only triggers for suppression and audit
-- ---------------------------------------------------------------------------

create or replace function public.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'This table is append-only; % is not allowed on %', tg_op, tg_table_name;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'suppressed_contacts_append_only'
      and tgrelid = 'public.suppressed_contacts'::regclass
  ) then
    create trigger suppressed_contacts_append_only
      before update or delete on public.suppressed_contacts
      for each row execute function public.reject_append_only_mutation();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'audit_logs_append_only'
      and tgrelid = 'public.audit_logs'::regclass
  ) then
    create trigger audit_logs_append_only
      before update or delete on public.audit_logs
      for each row execute function public.reject_append_only_mutation();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Suppression RPCs
-- ---------------------------------------------------------------------------

create or replace function public.is_suppressed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.suppressed_contacts
    where lower(email) = lower(trim(coalesce(p_email, '')))
  );
$$;

create or replace function public.suppress_contact(
  p_email text,
  p_reason text,
  p_source_message_id uuid default null
)
returns public.suppressed_contacts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_row public.suppressed_contacts;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_email';
  end if;

  insert into public.suppressed_contacts (email, reason, source_message_id)
  values (
    v_email,
    coalesce(nullif(trim(p_reason), ''), 'opt_out'),
    p_source_message_id
  )
  on conflict (lower(email)) do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row
    from public.suppressed_contacts
    where lower(email) = v_email;
    return v_row;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, detail)
  values (
    auth.uid(),
    'contact_suppressed',
    'suppressed_contacts',
    v_row.id,
    jsonb_build_object(
      'email', v_email,
      'reason', v_row.reason,
      'source_message_id', p_source_message_id
    )
  );

  return v_row;
end;
$$;

revoke all on function public.is_suppressed(text) from public;
revoke all on function public.suppress_contact(text, text, uuid) from public;
grant execute on function public.is_suppressed(text) to authenticated;
grant execute on function public.suppress_contact(text, text, uuid) to authenticated;

notify pgrst, 'reload schema';
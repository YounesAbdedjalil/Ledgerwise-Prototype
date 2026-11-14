-- Ledgerwise — migration 05
-- Correct suppression concurrency and audit actor authorization.
--
-- Apply only after migrations 01–04 have been reviewed and approved.

begin;

-- 1. Suppression records can be read by authenticated users,
--    but all writes must go through the SECURITY DEFINER RPC.
revoke insert on table public.suppressed_contacts
  from anon, authenticated;

grant select on table public.suppressed_contacts
  to authenticated;

drop policy if exists auth_insert_suppressed_contacts
  on public.suppressed_contacts;

-- 2. Authenticated users may create audit records only as themselves.
--    Existing application writers already supply actor_id = auth.uid().
drop policy if exists auth_insert_audit_logs
  on public.audit_logs;

create policy auth_insert_audit_logs
  on public.audit_logs
  for insert
  to authenticated
  with check (actor_id = auth.uid());

-- 3. Serialize suppression with booking operations.
--    This MUST use the same advisory lock as the calendar RPCs:
--    pg_advisory_xact_lock(734921, 1).
create or replace function public.suppress_contact(
  p_email text,
  p_reason text,
  p_source_message_id uuid default null
)
returns public.suppressed_contacts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_row public.suppressed_contacts;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if v_email = ''
    or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  then
    raise exception 'invalid_email';
  end if;

  -- Shared transaction lock with book_slot and other calendar mutations.
  perform pg_advisory_xact_lock(734921, 1);

  insert into public.suppressed_contacts (
    email,
    reason,
    source_message_id
  )
  values (
    v_email,
    coalesce(nullif(trim(p_reason), ''), 'opt_out'),
    p_source_message_id
  )
  on conflict (lower(email)) do nothing
  returning * into v_row;

  if v_row.id is null then
    select *
      into v_row
      from public.suppressed_contacts
      where lower(email) = v_email;

    return v_row;
  end if;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    detail
  )
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

revoke all on function public.suppress_contact(text, text, uuid)
  from public, anon, authenticated;

grant execute on function public.suppress_contact(text, text, uuid)
  to authenticated;

commit;

-- Ledgerwise migration 04
-- Transactional calendar operations and restricted table mutations.
--
-- Apply only after reviewing this migration alongside migrations 01-03.
-- All calendar mutations use one transaction-scoped advisory lock.
-- Google Calendar API calls remain outside these database transactions.

-- ---------------------------------------------------------------------------
-- 1. Create calendar slot
-- ---------------------------------------------------------------------------

create or replace function public.create_calendar_slot(
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_timezone text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_slot_id uuid;
  v_local_start timestamp;
  v_local_end timestamp;
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(734921, 1);

  if p_start_time is null or p_end_time is null
     or p_end_time <= p_start_time then
    raise exception 'Invalid slot time range';
  end if;

  if p_start_time <= now() then
    raise exception 'A calendar slot must be in the future';
  end if;

  if p_timezone is null or not exists (
    select 1 from pg_timezone_names where name = p_timezone
  ) then
    raise exception 'Invalid timezone';
  end if;

  if extract(epoch from (p_end_time - p_start_time)) / 60 not between 15 and 120 then
    raise exception 'Slot duration must be between 15 and 120 minutes';
  end if;

  v_local_start := p_start_time at time zone p_timezone;
  v_local_end := p_end_time at time zone p_timezone;

  if v_local_start::date <> v_local_end::date
     or v_local_start::time < time '09:00'
     or v_local_end::time > time '17:00' then
    raise exception 'Slots must remain within 09:00-17:00 local business hours';
  end if;

  if exists (
    select 1
    from public.calendar_slots s
    where s.is_available = true
      and s.start_time < p_end_time
      and s.end_time > p_start_time
  ) then
    raise exception 'This slot overlaps an existing available slot';
  end if;

  insert into public.calendar_slots (
    start_time,
    end_time,
    timezone,
    source,
    external_id,
    is_available,
    fetched_at
  )
  values (
    p_start_time,
    p_end_time,
    p_timezone,
    'internal',
    null,
    true,
    now()
  )
  returning id into v_slot_id;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, detail
  )
  values (
    v_actor,
    'calendar_slot_created',
    'calendar_slot',
    v_slot_id,
    jsonb_build_object(
      'start_time', p_start_time,
      'end_time', p_end_time,
      'timezone', p_timezone
    )
  );

  return v_slot_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- 2. Delete calendar slot
-- ---------------------------------------------------------------------------

create or replace function public.delete_calendar_slot(
  p_slot_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_slot public.calendar_slots%rowtype;
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  if p_slot_id is null then
    raise exception 'Slot ID is required';
  end if;

  perform pg_advisory_xact_lock(734921, 1);

  select *
  into v_slot
  from public.calendar_slots
  where id = p_slot_id
  for update;

  if not found then
    raise exception 'Calendar slot not found';
  end if;

  if exists (
    select 1
    from public.bookings b
    where b.slot_id = p_slot_id
      and b.status in ('pending', 'confirmed', 'needs_human')
  ) then
    raise exception 'Cannot delete a slot with an active booking';
  end if;

  if exists (
    select 1
    from public.bookings b
    where b.slot_id = p_slot_id
  ) then
    raise exception 'Cannot delete a slot referenced by booking history';
  end if;

  delete from public.calendar_slots
  where id = p_slot_id;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, detail
  )
  values (
    v_actor,
    'calendar_slot_deleted',
    'calendar_slot',
    p_slot_id,
    jsonb_build_object(
      'start_time', v_slot.start_time,
      'end_time', v_slot.end_time,
      'timezone', v_slot.timezone
    )
  );

  return true;
end;
$$;


-- ---------------------------------------------------------------------------
-- 3. Book slot
-- ---------------------------------------------------------------------------

create or replace function public.book_slot(
  p_slot_id uuid,
  p_company_id uuid,
  p_conversation_id uuid,
  p_prospect_name text,
  p_prospect_email text,
  p_timezone text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_slot public.calendar_slots%rowtype;
  v_booking_id uuid;
  v_company_id uuid := p_company_id;
  v_email text := lower(btrim(coalesce(p_prospect_email, '')));
  v_conversation_company_id uuid;
  v_conversation_email text;
  v_conversation_status text;
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(734921, 1);

  if p_slot_id is null then
    raise exception 'Slot ID is required';
  end if;

  if nullif(btrim(coalesce(p_prospect_name, '')), '') is null then
    raise exception 'Prospect name is required';
  end if;

  if v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'A valid prospect email is required';
  end if;

  if p_timezone is null or not exists (
    select 1 from pg_timezone_names where name = p_timezone
  ) then
    raise exception 'Invalid timezone';
  end if;

  if exists (
    select 1
    from public.suppressed_contacts s
    where lower(s.email) = v_email
  ) then
    raise exception 'This contact is suppressed';
  end if;

  if p_conversation_id is not null then
    select c.company_id, lower(c.contact_email), c.status
    into v_conversation_company_id, v_conversation_email, v_conversation_status
    from public.conversations c
    where c.id = p_conversation_id
    for update;

    if not found then
      raise exception 'Conversation not found';
    end if;

    if v_conversation_status = 'suppressed' then
      raise exception 'This conversation is suppressed';
    end if;

    if v_conversation_email <> v_email then
      raise exception 'Prospect email does not match the conversation';
    end if;

    if v_company_id is null then
      v_company_id := v_conversation_company_id;
    elsif v_company_id <> v_conversation_company_id then
      raise exception 'Company does not match the conversation';
    end if;
  end if;

  select *
  into v_slot
  from public.calendar_slots
  where id = p_slot_id
  for update;

  if not found then
    raise exception 'Calendar slot not found';
  end if;

  if not v_slot.is_available then
    raise exception 'This slot is not available';
  end if;

  if v_slot.start_time <= now() then
    raise exception 'This slot is in the past';
  end if;

  if exists (
    select 1
    from public.bookings b
    join public.calendar_slots s on s.id = b.slot_id
    where b.status in ('pending', 'confirmed', 'needs_human')
      and s.start_time < v_slot.end_time
      and s.end_time > v_slot.start_time
  ) then
    raise exception 'This time overlaps an existing booking';
  end if;

  insert into public.bookings (
    company_id,
    conversation_id,
    slot_id,
    prospect_name,
    prospect_email,
    timezone,
    status
  )
  values (
    v_company_id,
    p_conversation_id,
    p_slot_id,
    btrim(p_prospect_name),
    v_email,
    p_timezone,
    'pending'
  )
  returning id into v_booking_id;

  if p_conversation_id is not null then
    update public.conversations
    set status = 'human_takeover',
        booking_request = false
    where id = p_conversation_id;
  end if;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, detail
  )
  values (
    v_actor,
    'booking_created',
    'booking',
    v_booking_id,
    jsonb_build_object(
      'slot_id', p_slot_id,
      'company_id', v_company_id,
      'conversation_id', p_conversation_id,
      'prospect_email', v_email,
      'status', 'pending'
    )
  );

  return v_booking_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. Confirm booking
-- ---------------------------------------------------------------------------

create or replace function public.confirm_booking(
  p_booking_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_slot public.calendar_slots%rowtype;
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  if p_booking_id is null then
    raise exception 'Booking ID is required';
  end if;

  perform pg_advisory_xact_lock(734921, 1);

  select *
  into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'Booking not found';
  end if;

  if v_booking.status not in ('pending', 'needs_human') then
    raise exception 'This booking cannot be confirmed from its current status';
  end if;

  if exists (
    select 1
    from public.suppressed_contacts s
    where lower(s.email) = lower(v_booking.prospect_email)
  ) then
    raise exception 'This contact is suppressed';
  end if;

  if v_booking.slot_id is null then
    raise exception 'Booking has no calendar slot';
  end if;

  select *
  into v_slot
  from public.calendar_slots
  where id = v_booking.slot_id
  for update;

  if not found or not v_slot.is_available or v_slot.start_time <= now() then
    raise exception 'The booked slot is no longer available';
  end if;

  if exists (
    select 1
    from public.bookings b
    join public.calendar_slots s on s.id = b.slot_id
    where b.id <> p_booking_id
      and b.status in ('pending', 'confirmed', 'needs_human')
      and s.start_time < v_slot.end_time
      and s.end_time > v_slot.start_time
  ) then
    raise exception 'Another active booking overlaps this slot';
  end if;

  update public.bookings
  set status = 'confirmed'
  where id = p_booking_id;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, detail
  )
  values (
    v_actor,
    'booking_confirmed',
    'booking',
    p_booking_id,
    jsonb_build_object('previous_status', v_booking.status)
  );

  return true;
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. Cancel booking
-- ---------------------------------------------------------------------------

create or replace function public.cancel_booking(
  p_booking_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  if p_booking_id is null then
    raise exception 'Booking ID is required';
  end if;

  if v_reason is null then
    raise exception 'A cancellation reason is required';
  end if;

  perform pg_advisory_xact_lock(734921, 1);

  select *
  into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'Booking not found';
  end if;

  if v_booking.status not in ('pending', 'confirmed', 'needs_human') then
    raise exception 'This booking cannot be cancelled from its current status';
  end if;

  update public.bookings
  set status = 'cancelled'
  where id = p_booking_id;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, detail
  )
  values (
    v_actor,
    'booking_cancelled',
    'booking',
    p_booking_id,
    jsonb_build_object(
      'previous_status', v_booking.status,
      'reason', v_reason,
      'slot_id', v_booking.slot_id
    )
  );

  return true;
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. Reschedule booking
-- ---------------------------------------------------------------------------

create or replace function public.reschedule_booking(
  p_booking_id uuid,
  p_new_slot_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_new_slot public.calendar_slots%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_old_slot_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  if p_booking_id is null or p_new_slot_id is null then
    raise exception 'Booking ID and new slot ID are required';
  end if;

  if v_reason is null then
    raise exception 'A rescheduling reason is required';
  end if;

  perform pg_advisory_xact_lock(734921, 1);

  select *
  into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'Booking not found';
  end if;

  if v_booking.status not in ('pending', 'confirmed', 'needs_human') then
    raise exception 'This booking cannot be rescheduled from its current status';
  end if;

  if v_booking.slot_id = p_new_slot_id then
    raise exception 'Choose a different slot';
  end if;

  if exists (
    select 1
    from public.suppressed_contacts s
    where lower(s.email) = lower(v_booking.prospect_email)
  ) then
    raise exception 'This contact is suppressed';
  end if;

  v_old_slot_id := v_booking.slot_id;

  -- Lock both slot rows in stable ID order.
  perform s.id
  from public.calendar_slots s
  where s.id in (v_old_slot_id, p_new_slot_id)
  order by s.id
  for update;

  select *
  into v_new_slot
  from public.calendar_slots
  where id = p_new_slot_id;

  if not found then
    raise exception 'New calendar slot not found';
  end if;

  if not v_new_slot.is_available or v_new_slot.start_time <= now() then
    raise exception 'New slot is not available';
  end if;

  if exists (
    select 1
    from public.bookings b
    join public.calendar_slots s on s.id = b.slot_id
    where b.id <> p_booking_id
      and b.status in ('pending', 'confirmed', 'needs_human')
      and s.start_time < v_new_slot.end_time
      and s.end_time > v_new_slot.start_time
  ) then
    raise exception 'New slot overlaps an existing booking';
  end if;

  update public.bookings
  set slot_id = p_new_slot_id,
      status = 'pending'
  where id = p_booking_id;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, detail
  )
  values (
    v_actor,
    'booking_rescheduled',
    'booking',
    p_booking_id,
    jsonb_build_object(
      'old_slot_id', v_old_slot_id,
      'new_slot_id', p_new_slot_id,
      'previous_status', v_booking.status,
      'reason', v_reason
    )
  );

  return true;
end;
$$;


-- ---------------------------------------------------------------------------
-- 7. Record Google Calendar sync metadata
-- ---------------------------------------------------------------------------
-- This RPC only updates sync metadata. It does not perform Google API calls.
-- OAuth, token security, retries, and reconciliation are separate work.

create or replace function public.record_google_calendar_sync(
  p_booking_id uuid,
  p_status text,
  p_event_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  if p_booking_id is null then
    raise exception 'Booking ID is required';
  end if;

  if p_status not in ('pending', 'synced', 'failed', 'deleted', 'not_configured') then
    raise exception 'Invalid Google Calendar sync status';
  end if;

  if p_status = 'synced' and nullif(btrim(coalesce(p_event_id, '')), '') is null then
    raise exception 'A Google event ID is required for synced status';
  end if;

  update public.bookings
  set google_event_id = case
        when p_status = 'deleted' then null
        when p_event_id is not null then p_event_id
        else google_event_id
      end,
      calendar_sync_status = p_status,
      calendar_synced_at = now()
  where id = p_booking_id;

  if not found then
    raise exception 'Booking not found';
  end if;

  return true;
end;
$$;


-- ---------------------------------------------------------------------------
-- 8. Restrict direct table mutations
-- ---------------------------------------------------------------------------

revoke all on table public.calendar_slots from anon, authenticated;
revoke all on table public.bookings from anon, authenticated;
revoke all on table public.audit_logs from anon, authenticated;

grant select on table public.calendar_slots to authenticated;
grant select on table public.bookings to authenticated;
grant select, insert on table public.audit_logs to authenticated;

-- Conversations retain their existing application workflow permissions.
revoke all on table public.conversations from anon;
grant select, insert, update on table public.conversations to authenticated;


-- ---------------------------------------------------------------------------
-- 9. Restrict RPC execution
-- ---------------------------------------------------------------------------

revoke all on function public.create_calendar_slot(timestamptz, timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.delete_calendar_slot(uuid)
  from public, anon, authenticated;
revoke all on function public.book_slot(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.confirm_booking(uuid)
  from public, anon, authenticated;
revoke all on function public.cancel_booking(uuid, text)
  from public, anon, authenticated;
revoke all on function public.reschedule_booking(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.record_google_calendar_sync(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.create_calendar_slot(timestamptz, timestamptz, text)
  to authenticated;
grant execute on function public.delete_calendar_slot(uuid)
  to authenticated;
grant execute on function public.book_slot(uuid, uuid, uuid, text, text, text)
  to authenticated;
grant execute on function public.confirm_booking(uuid)
  to authenticated;
grant execute on function public.cancel_booking(uuid, text)
  to authenticated;
grant execute on function public.reschedule_booking(uuid, uuid, text)
  to authenticated;
grant execute on function public.record_google_calendar_sync(uuid, text, text)
  to authenticated;

notify pgrst, 'reload schema';

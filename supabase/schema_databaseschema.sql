


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."block_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  raise exception '% on % is not allowed (append-only table)', tg_op, tg_table_name;
end $$;


ALTER FUNCTION "public"."block_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."book_slot"("p_slot_id" "uuid", "p_company_id" "uuid", "p_conversation_id" "uuid", "p_prospect_name" "text", "p_prospect_email" "text", "p_timezone" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."book_slot"("p_slot_id" "uuid", "p_company_id" "uuid", "p_conversation_id" "uuid", "p_prospect_name" "text", "p_prospect_email" "text", "p_timezone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_booking"("p_booking_id" "uuid", "p_reason" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."cancel_booking"("p_booking_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_booking"("p_booking_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."confirm_booking"("p_booking_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_calendar_slot"("p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_timezone" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."create_calendar_slot"("p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_timezone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_calendar_slot"("p_slot_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."delete_calendar_slot"("p_slot_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.users (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_suppressed"("p_email" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.suppressed_contacts
    where lower(email) = lower(trim(coalesce(p_email, '')))
  );
$$;


ALTER FUNCTION "public"."is_suppressed"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_google_calendar_sync"("p_booking_id" "uuid", "p_status" "text", "p_event_id" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."record_google_calendar_sync"("p_booking_id" "uuid", "p_status" "text", "p_event_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reject_append_only_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  raise exception 'This table is append-only; % is not allowed on %', tg_op, tg_table_name;
end;
$$;


ALTER FUNCTION "public"."reject_append_only_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reschedule_booking"("p_booking_id" "uuid", "p_new_slot_id" "uuid", "p_reason" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."reschedule_booking"("p_booking_id" "uuid", "p_new_slot_id" "uuid", "p_reason" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."suppressed_contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "source_message_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."suppressed_contacts" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."suppress_contact"("p_email" "text", "p_reason" "text", "p_source_message_id" "uuid" DEFAULT NULL::"uuid") RETURNS "public"."suppressed_contacts"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."suppress_contact"("p_email" "text", "p_reason" "text", "p_source_message_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_id" "uuid",
    "action" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid",
    "detail" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid",
    "conversation_id" "uuid",
    "slot_id" "uuid",
    "prospect_name" "text",
    "prospect_email" "text" NOT NULL,
    "timezone" "text" DEFAULT 'UTC'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "calcom_booking_uid" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "google_event_id" "text",
    "calendar_sync_status" "text" DEFAULT 'not_configured'::"text" NOT NULL,
    "calendar_synced_at" timestamp with time zone,
    CONSTRAINT "bookings_calendar_sync_status_check" CHECK (("calendar_sync_status" = ANY (ARRAY['not_configured'::"text", 'pending'::"text", 'synced'::"text", 'failed'::"text", 'deleted'::"text"]))),
    CONSTRAINT "bookings_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'needs_human'::"text", 'rescheduled'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."bookings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calendar_slots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone NOT NULL,
    "timezone" "text" DEFAULT 'UTC'::"text" NOT NULL,
    "source" "text" DEFAULT 'internal'::"text" NOT NULL,
    "external_id" "text",
    "is_available" boolean DEFAULT true NOT NULL,
    "fetched_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "google_calendar_id" "text",
    CONSTRAINT "calendar_slots_check" CHECK (("end_time" > "start_time")),
    CONSTRAINT "calendar_slots_source_check" CHECK (("source" = ANY (ARRAY['calcom'::"text", 'demo'::"text", 'internal'::"text"])))
);


ALTER TABLE "public"."calendar_slots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."companies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "website" "text" NOT NULL,
    "category" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "us_ecommerce" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "contact_name" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "contact_role" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "contact_email" "text",
    "growth_signal" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "research_notes" "text",
    "total_score" integer DEFAULT 0 NOT NULL,
    "qualification_status" "text" DEFAULT 'new'::"text" NOT NULL,
    "spot_checked" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "companies_qualification_status_check" CHECK (("qualification_status" = ANY (ARRAY['new'::"text", 'qualified'::"text", 'not_qualified'::"text", 'needs_review'::"text"]))),
    CONSTRAINT "companies_us_ecommerce_check" CHECK (("us_ecommerce" = ANY (ARRAY['verified'::"text", 'unknown'::"text"])))
);


ALTER TABLE "public"."companies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_sources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "claim" "text" NOT NULL,
    "claim_type" "text" NOT NULL,
    "source_url" "text" NOT NULL,
    "source_title" "text" NOT NULL,
    "retrieved_at" "date" NOT NULL,
    "evidence" "text" NOT NULL,
    "verified_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "imported_by" "uuid",
    "verification_status" "text" DEFAULT 'pending_review'::"text" NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "verification_note" "text",
    CONSTRAINT "company_sources_claim_type_check" CHECK (("claim_type" = ANY (ARRAY['us_ecommerce'::"text", 'category'::"text", 'size_fit'::"text", 'growth_signal'::"text", 'pain_signal'::"text", 'disqualifier'::"text", 'contact'::"text"]))),
    CONSTRAINT "company_sources_source_url_check" CHECK (("source_url" ~* '^https?://'::"text")),
    CONSTRAINT "company_sources_verification_status_check" CHECK (("verification_status" = ANY (ARRAY['pending_review'::"text", 'verified'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."company_sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "contact_email" "text" NOT NULL,
    "status" "text" DEFAULT 'ai_handling'::"text" NOT NULL,
    "assigned_to" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ai_processing_at" timestamp with time zone,
    "booking_request" boolean DEFAULT false NOT NULL,
    CONSTRAINT "conversations_status_check" CHECK (("status" = ANY (ARRAY['ai_handling'::"text", 'needs_human'::"text", 'human_takeover'::"text", 'closed'::"text", 'suppressed'::"text"])))
);


ALTER TABLE "public"."conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."discovery_candidates" (
    "host" "text" NOT NULL,
    "company_name" "text",
    "status" "text" DEFAULT 'rejected'::"text" NOT NULL,
    "stage" "text" NOT NULL,
    "reason" "text",
    "query" "text",
    "checked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "checked_by" "uuid",
    CONSTRAINT "discovery_candidates_status_check" CHECK (("status" = 'rejected'::"text"))
);


ALTER TABLE "public"."discovery_candidates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_drafts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "subject" "text" NOT NULL,
    "body" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "source_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "revision_note" "text",
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "email_drafts_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'needs_review'::"text", 'approved'::"text", 'rejected'::"text", 'sent_simulated'::"text", 'sent'::"text"])))
);


ALTER TABLE "public"."email_drafts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "draft_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "actor_id" "uuid",
    "detail" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."email_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "sender" "text" NOT NULL,
    "body" "text" NOT NULL,
    "classification" "text",
    "needs_review" boolean DEFAULT false NOT NULL,
    "guardrail_flags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "is_simulated" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "messages_sender_check" CHECK (("sender" = ANY (ARRAY['prospect'::"text", 'ai'::"text", 'human'::"text"])))
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."qualification_scores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "criterion" "text" NOT NULL,
    "weight" integer NOT NULL,
    "points" integer NOT NULL,
    "reason" "text" NOT NULL,
    "source_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "qualification_scores_check" CHECK (("points" <= "weight")),
    CONSTRAINT "qualification_scores_check1" CHECK ((("points" = 0) OR ("source_id" IS NOT NULL))),
    CONSTRAINT "qualification_scores_points_check" CHECK (("points" >= 0)),
    CONSTRAINT "qualification_scores_weight_check" CHECK (("weight" > 0))
);


ALTER TABLE "public"."qualification_scores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text",
    "role" "text" DEFAULT 'sales'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."users" OWNER TO "postgres";


ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calendar_slots"
    ADD CONSTRAINT "calendar_slots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_sources"
    ADD CONSTRAINT "company_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."discovery_candidates"
    ADD CONSTRAINT "discovery_candidates_pkey" PRIMARY KEY ("host");



ALTER TABLE ONLY "public"."email_drafts"
    ADD CONSTRAINT "email_drafts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_events"
    ADD CONSTRAINT "email_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."qualification_scores"
    ADD CONSTRAINT "qualification_scores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."suppressed_contacts"
    ADD CONSTRAINT "suppressed_contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "audit_logs_entity_idx" ON "public"."audit_logs" USING "btree" ("entity_type", "entity_id");



CREATE UNIQUE INDEX "bookings_active_slot_unique" ON "public"."bookings" USING "btree" ("slot_id") WHERE (("slot_id" IS NOT NULL) AND ("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'needs_human'::"text"])));



CREATE INDEX "bookings_company_idx" ON "public"."bookings" USING "btree" ("company_id");



CREATE INDEX "bookings_conversation_idx" ON "public"."bookings" USING "btree" ("conversation_id");



CREATE INDEX "bookings_slot_status_idx" ON "public"."bookings" USING "btree" ("slot_id", "status");



CREATE INDEX "company_sources_company_id_idx" ON "public"."company_sources" USING "btree" ("company_id");



CREATE INDEX "company_sources_company_verification_idx" ON "public"."company_sources" USING "btree" ("company_id", "verification_status");



CREATE INDEX "company_sources_verification_status_idx" ON "public"."company_sources" USING "btree" ("verification_status");



CREATE INDEX "conversations_booking_request_idx" ON "public"."conversations" USING "btree" ("booking_request") WHERE ("booking_request" = true);



CREATE INDEX "conversations_company_status_idx" ON "public"."conversations" USING "btree" ("company_id", "status");



CREATE INDEX "discovery_candidates_checked_at_idx" ON "public"."discovery_candidates" USING "btree" ("checked_at" DESC);



CREATE INDEX "email_drafts_company_status_idx" ON "public"."email_drafts" USING "btree" ("company_id", "status");



CREATE INDEX "email_events_draft_created_idx" ON "public"."email_events" USING "btree" ("draft_id", "created_at");



CREATE INDEX "messages_conversation_created_idx" ON "public"."messages" USING "btree" ("conversation_id", "created_at");



CREATE INDEX "qualification_scores_company_id_idx" ON "public"."qualification_scores" USING "btree" ("company_id");



CREATE UNIQUE INDEX "suppressed_contacts_email_lower_idx" ON "public"."suppressed_contacts" USING "btree" ("lower"("email"));



CREATE UNIQUE INDEX "suppressed_email_unique" ON "public"."suppressed_contacts" USING "btree" ("lower"("email"));



CREATE OR REPLACE TRIGGER "audit_logs_append_only" BEFORE DELETE OR UPDATE ON "public"."audit_logs" FOR EACH ROW EXECUTE FUNCTION "public"."block_changes"();



CREATE OR REPLACE TRIGGER "suppressed_contacts_append_only" BEFORE DELETE OR UPDATE ON "public"."suppressed_contacts" FOR EACH ROW EXECUTE FUNCTION "public"."reject_append_only_mutation"();



CREATE OR REPLACE TRIGGER "suppressed_permanent" BEFORE DELETE OR UPDATE ON "public"."suppressed_contacts" FOR EACH ROW EXECUTE FUNCTION "public"."block_changes"();



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "public"."calendar_slots"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."company_sources"
    ADD CONSTRAINT "company_sources_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_sources"
    ADD CONSTRAINT "company_sources_imported_by_fkey" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."company_sources"
    ADD CONSTRAINT "company_sources_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."company_sources"
    ADD CONSTRAINT "company_sources_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_drafts"
    ADD CONSTRAINT "email_drafts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_drafts"
    ADD CONSTRAINT "email_drafts_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."email_events"
    ADD CONSTRAINT "email_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."email_events"
    ADD CONSTRAINT "email_events_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "public"."email_drafts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."qualification_scores"
    ADD CONSTRAINT "qualification_scores_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."qualification_scores"
    ADD CONSTRAINT "qualification_scores_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."company_sources"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."suppressed_contacts"
    ADD CONSTRAINT "suppressed_contacts_source_message_id_fkey" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "auth read" ON "public"."users" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_delete_calendar_slots" ON "public"."calendar_slots" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "auth_insert_audit_logs" ON "public"."audit_logs" FOR INSERT TO "authenticated" WITH CHECK (("actor_id" = "auth"."uid"()));



CREATE POLICY "auth_insert_bookings" ON "public"."bookings" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "auth_insert_calendar_slots" ON "public"."calendar_slots" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "auth_insert_companies" ON "public"."companies" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "auth_insert_company_sources" ON "public"."company_sources" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "auth_insert_conversations" ON "public"."conversations" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "auth_insert_discovery_candidates" ON "public"."discovery_candidates" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "auth_insert_email_drafts" ON "public"."email_drafts" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "auth_insert_email_events" ON "public"."email_events" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "auth_insert_messages" ON "public"."messages" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "auth_insert_qualification_scores" ON "public"."qualification_scores" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "auth_select_audit_logs" ON "public"."audit_logs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_select_bookings" ON "public"."bookings" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_select_calendar_slots" ON "public"."calendar_slots" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_select_companies" ON "public"."companies" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_select_company_sources" ON "public"."company_sources" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_select_conversations" ON "public"."conversations" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_select_discovery_candidates" ON "public"."discovery_candidates" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_select_email_drafts" ON "public"."email_drafts" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_select_email_events" ON "public"."email_events" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_select_messages" ON "public"."messages" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_select_qualification_scores" ON "public"."qualification_scores" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_select_suppressed_contacts" ON "public"."suppressed_contacts" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_update_bookings" ON "public"."bookings" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "auth_update_calendar_slots" ON "public"."calendar_slots" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "auth_update_companies" ON "public"."companies" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "auth_update_company_sources" ON "public"."company_sources" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "auth_update_conversations" ON "public"."conversations" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "auth_update_discovery_candidates" ON "public"."discovery_candidates" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "auth_update_email_drafts" ON "public"."email_drafts" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "auth_update_messages" ON "public"."messages" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "auth_update_qualification_scores" ON "public"."qualification_scores" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."calendar_slots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."companies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."company_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."discovery_candidates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_drafts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."qualification_scores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."suppressed_contacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."block_changes"() TO "anon";
GRANT ALL ON FUNCTION "public"."block_changes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."block_changes"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."book_slot"("p_slot_id" "uuid", "p_company_id" "uuid", "p_conversation_id" "uuid", "p_prospect_name" "text", "p_prospect_email" "text", "p_timezone" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."book_slot"("p_slot_id" "uuid", "p_company_id" "uuid", "p_conversation_id" "uuid", "p_prospect_name" "text", "p_prospect_email" "text", "p_timezone" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."book_slot"("p_slot_id" "uuid", "p_company_id" "uuid", "p_conversation_id" "uuid", "p_prospect_name" "text", "p_prospect_email" "text", "p_timezone" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."cancel_booking"("p_booking_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_booking"("p_booking_id" "uuid", "p_reason" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."cancel_booking"("p_booking_id" "uuid", "p_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."confirm_booking"("p_booking_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_booking"("p_booking_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."confirm_booking"("p_booking_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_calendar_slot"("p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_timezone" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_calendar_slot"("p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_timezone" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."create_calendar_slot"("p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_timezone" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."delete_calendar_slot"("p_slot_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_calendar_slot"("p_slot_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."delete_calendar_slot"("p_slot_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_suppressed"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_suppressed"("p_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_suppressed"("p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_suppressed"("p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_google_calendar_sync"("p_booking_id" "uuid", "p_status" "text", "p_event_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_google_calendar_sync"("p_booking_id" "uuid", "p_status" "text", "p_event_id" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."record_google_calendar_sync"("p_booking_id" "uuid", "p_status" "text", "p_event_id" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."reject_append_only_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."reject_append_only_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reject_append_only_mutation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."reschedule_booking"("p_booking_id" "uuid", "p_new_slot_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reschedule_booking"("p_booking_id" "uuid", "p_new_slot_id" "uuid", "p_reason" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."reschedule_booking"("p_booking_id" "uuid", "p_new_slot_id" "uuid", "p_reason" "text") TO "authenticated";



GRANT ALL ON TABLE "public"."suppressed_contacts" TO "service_role";
GRANT SELECT ON TABLE "public"."suppressed_contacts" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."suppress_contact"("p_email" "text", "p_reason" "text", "p_source_message_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."suppress_contact"("p_email" "text", "p_reason" "text", "p_source_message_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."suppress_contact"("p_email" "text", "p_reason" "text", "p_source_message_id" "uuid") TO "authenticated";



GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."audit_logs" TO "authenticated";



GRANT ALL ON TABLE "public"."bookings" TO "service_role";
GRANT SELECT ON TABLE "public"."bookings" TO "authenticated";



GRANT ALL ON TABLE "public"."calendar_slots" TO "service_role";
GRANT SELECT ON TABLE "public"."calendar_slots" TO "authenticated";



GRANT ALL ON TABLE "public"."companies" TO "anon";
GRANT ALL ON TABLE "public"."companies" TO "authenticated";
GRANT ALL ON TABLE "public"."companies" TO "service_role";



GRANT ALL ON TABLE "public"."company_sources" TO "anon";
GRANT ALL ON TABLE "public"."company_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."company_sources" TO "service_role";



GRANT ALL ON TABLE "public"."conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations" TO "service_role";



GRANT ALL ON TABLE "public"."discovery_candidates" TO "anon";
GRANT ALL ON TABLE "public"."discovery_candidates" TO "authenticated";
GRANT ALL ON TABLE "public"."discovery_candidates" TO "service_role";



GRANT ALL ON TABLE "public"."email_drafts" TO "anon";
GRANT ALL ON TABLE "public"."email_drafts" TO "authenticated";
GRANT ALL ON TABLE "public"."email_drafts" TO "service_role";



GRANT ALL ON TABLE "public"."email_events" TO "anon";
GRANT ALL ON TABLE "public"."email_events" TO "authenticated";
GRANT ALL ON TABLE "public"."email_events" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."qualification_scores" TO "anon";
GRANT ALL ON TABLE "public"."qualification_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."qualification_scores" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";








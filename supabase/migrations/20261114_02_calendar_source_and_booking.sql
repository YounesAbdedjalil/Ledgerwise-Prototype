-- Ledgerwise prototype — migration 02
-- Internal calendar source, conversation booking flag, and slot occupancy guarantee.
--
-- Apply after migration 01. Run manually in the Supabase SQL Editor.

-- Conversations carry an explicit booking-request flag. A booking request is a
-- needs_human conversation plus this flag; it does not create or hold a booking.
alter table public.conversations
  add column if not exists booking_request boolean not null default false;

-- Replace the old calendar source check so internal slots are allowed.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.calendar_slots'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%source%'
  loop
    execute format('alter table public.calendar_slots drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.calendar_slots
  add constraint calendar_slots_source_check
  check (source in ('calcom', 'demo', 'internal'));

alter table public.calendar_slots
  alter column source set default 'internal';

-- Before this index can be created, check for existing conflicts:
--
-- select slot_id, count(*)
-- from public.bookings
-- where slot_id is not null
--   and status in ('pending', 'confirmed', 'needs_human')
-- group by slot_id
-- having count(*) > 1;
--
-- If that query returns rows, resolve the duplicates first. Then run this file.
create unique index if not exists bookings_active_slot_unique
  on public.bookings (slot_id)
  where slot_id is not null
    and status in ('pending', 'confirmed', 'needs_human');

create index if not exists bookings_slot_status_idx
  on public.bookings (slot_id, status);
create index if not exists bookings_conversation_idx
  on public.bookings (conversation_id);
create index if not exists bookings_company_idx
  on public.bookings (company_id);
create index if not exists conversations_booking_request_idx
  on public.conversations (booking_request)
  where booking_request = true;

notify pgrst, 'reload schema';
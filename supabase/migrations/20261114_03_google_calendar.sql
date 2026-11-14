-- Ledgerwise prototype — migration 03
-- Optional Google Calendar sync metadata. The internal calendar works without this.
--
-- Apply after migration 02. Run manually in the Supabase SQL Editor.

alter table public.bookings
  add column if not exists google_event_id text;
alter table public.bookings
  add column if not exists calendar_sync_status text not null default 'not_configured';
alter table public.bookings
  add column if not exists calendar_synced_at timestamptz;
alter table public.calendar_slots
  add column if not exists google_calendar_id text;

-- Keep this constraint idempotent so an earlier draft can be re-applied safely.
alter table public.bookings
  drop constraint if exists bookings_calendar_sync_status_check;
alter table public.bookings
  add constraint bookings_calendar_sync_status_check
  check (
    calendar_sync_status in (
      'not_configured',
      'pending',
      'synced',
      'failed',
      'deleted'
    )
  );

notify pgrst, 'reload schema';
# Unapplied migrations

These define SECURITY DEFINER calendar functions and revoke direct writes to bookings and calendar_slots. The app does NOT call them yet. Applying them now breaks slot creation and booking. Apply only after calendar/actions.ts is rewritten to call them and tested on a real database.

# Unapplied migrations

These two files define SECURITY DEFINER calendar functions and revoke direct
write access to `bookings` and `calendar_slots`. The application does NOT call
these functions yet: calendar actions still write to the tables directly.

Applying them now would make slot creation, booking, confirmation, cancellation
and rescheduling fail with "permission denied".

Apply them only after `app/(dashboard)/calendar/actions.ts` has been rewritten to
call the functions, and the rewrite has been tested against a real database.

# Optional Google Calendar

The prototype does **not** depend on Google Calendar. Internal slots and bookings
work with no Google credentials.

## Status shown in the app

The Calendar page calls `googleCalendarStatus()` and reports one of these states:

- credentials missing → not configured;
- credentials present but `GOOGLE_CALENDAR_VERIFIED` is not `1` → not verified;
- verified but `GOOGLE_CALENDAR_SYNC` is not `1` → sync disabled;
- all three conditions met → sync enabled and reported as verified by the operator.

Do not describe Google Calendar as operational until a real OAuth connection,
event creation, and an external check have been performed.

## Optional environment variables

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_CALENDAR_ID=
GOOGLE_CALENDAR_VERIFIED=0
GOOGLE_CALENDAR_SYNC=0
```

Set `GOOGLE_CALENDAR_VERIFIED=1` only after you have tested OAuth, event
creation, update, and deletion externally. Set `GOOGLE_CALENDAR_SYNC=1` only when
you want booking changes to sync to Google.

## What sync does

When both flags are enabled:

- `bookSlot` calls `syncBookingToGoogle()` to create an event and store
  `google_event_id`, `calendar_sync_status`, and `calendar_synced_at`;
- `rescheduleBooking` calls `updateGoogleEvent()` for the linked event (or tries
  to create one if the earlier creation failed);
- `cancelBooking` calls `deleteGoogleEvent()` and records
  `calendar_sync_status = 'deleted'`;
- `confirmBooking` retries event creation when a pending booking has no linked
  event yet.

Each call exchanges the refresh token for an access token first. A Google `404`
or `410` during deletion is treated as success because the event is already gone.

If sync fails, the internal booking remains. The booking is not rolled back. The
sync status is marked `failed` and the booking continues to work internally. The
internal calendar is always authoritative.

## Limits

- No OAuth connect/callback flow is included. Use a refresh token you created
  yourself.
- A reschedule requires an existing linked event or a successful create attempt;
  if Google sync is disabled, the internal booking still changes and the app
  reports that the external event was not updated.
- Apply migration 03 before enabling sync. The migration adds the `deleted`
  sync status and is safe to re-run.
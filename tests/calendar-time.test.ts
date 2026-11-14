import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeBookingForSlot,
  canDeleteSlot,
  defaultLocalSlot,
  formatSlotRange,
  isOccupyingBooking,
  validateBookingInput,
  validateSlotInput,
  zonedDateTimeToIso,
} from "../lib/calendar/time";

const now = new Date("2026-11-14T12:00:00.000Z");

function slot(startLocal: string, endLocal: string, startOffsetDays = 1) {
  const base = new Date(now.getTime() + startOffsetDays * 24 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
  const startIso = zonedDateTimeToIso(`${base}T${startLocal}`, "America/New_York")!;
  const endIso = zonedDateTimeToIso(`${base}T${endLocal}`, "America/New_York")!;
  return { startTime: startIso, endTime: endIso, timezone: "America/New_York" };
}

test("a valid 30-minute business-hours slot passes", () => {
  const result = validateSlotInput(slot("09:00", "09:30"), now);
  assert.equal(result.ok, true);
});

test("slot durations are limited to 15–120 minutes", () => {
  assert.equal(validateSlotInput(slot("09:00", "09:10"), now).ok, false);
  assert.equal(validateSlotInput(slot("09:00", "09:15"), now).ok, true);
  assert.equal(validateSlotInput(slot("09:00", "11:00"), now).ok, true);
  assert.equal(validateSlotInput(slot("09:00", "11:01"), now).ok, false);
});

test("slots must fit inside 9:00–17:00 local time", () => {
  assert.equal(validateSlotInput(slot("08:45", "09:15"), now).ok, false);
  assert.equal(validateSlotInput(slot("16:45", "17:15"), now).ok, false);
  assert.equal(validateSlotInput(slot("16:30", "17:00"), now).ok, true);
});

test("slots must be in the future and use a valid timezone", () => {
  const past = validateSlotInput(
    {
      startTime: "2020-01-01T09:00:00.000Z",
      endTime: "2020-01-01T09:30:00.000Z",
      timezone: "America/New_York",
    },
    now
  );
  assert.equal(past.ok, false);
  assert.ok(past.errors.some((error) => /future/.test(error)));

  const badZone = validateSlotInput(
    { ...slot("09:00", "09:30"), timezone: "Mars/Olympus" },
    now
  );
  assert.equal(badZone.ok, false);
});

test("zoned conversion handles standard and daylight time", () => {
  assert.equal(
    zonedDateTimeToIso("2026-11-15T09:00", "America/New_York"),
    "2026-11-15T14:00:00.000Z"
  );
  assert.equal(
    zonedDateTimeToIso("2026-07-15T09:00", "America/New_York"),
    "2026-07-15T13:00:00.000Z"
  );
  assert.equal(zonedDateTimeToIso("not-a-date", "America/New_York"), null);
  assert.equal(zonedDateTimeToIso("2026-07-15T09:00", "Mars/Olympus"), null);
});

test("only pending, confirmed, and needs-human bookings occupy a slot", () => {
  assert.equal(isOccupyingBooking("pending"), true);
  assert.equal(isOccupyingBooking("confirmed"), true);
  assert.equal(isOccupyingBooking("needs_human"), true);
  assert.equal(isOccupyingBooking("cancelled"), false);
  assert.equal(isOccupyingBooking("rescheduled"), false);

  const bookings = [
    { slot_id: "slot-1", status: "cancelled" },
    { slot_id: "slot-2", status: "confirmed" },
  ];
  assert.equal(activeBookingForSlot(bookings, "slot-1"), null);
  assert.equal(activeBookingForSlot(bookings, "slot-2")?.status, "confirmed");
  assert.equal(canDeleteSlot(bookings, "slot-1"), true);
  assert.equal(canDeleteSlot(bookings, "slot-2"), false);
});

test("booking input requires a name, a valid email, and a timezone", () => {
  assert.equal(
    validateBookingInput({
      prospectName: "Jane Doe",
      prospectEmail: "jane@acme.test",
      timezone: "America/New_York",
    }).ok,
    true
  );
  assert.equal(
    validateBookingInput({
      prospectName: "",
      prospectEmail: "nope",
      timezone: "Mars/Olympus",
    }).ok,
    false
  );
});

test("slot range formatting includes the timezone", () => {
  const label = formatSlotRange(
    "2026-11-15T14:00:00.000Z",
    "2026-11-15T14:30:00.000Z",
    "America/New_York"
  );
  assert.match(label, /9:00 AM/);
  assert.match(label, /America\/New_York/);
});

test("zoned conversion rejects nonexistent and ambiguous DST times", () => {
  // New York jumps from 01:59 to 03:00 on this date.
  assert.equal(
    zonedDateTimeToIso("2026-03-08T02:30", "America/New_York"),
    null
  );

  // New York repeats the 01:00 hour on this date.
  assert.equal(
    zonedDateTimeToIso("2026-11-01T01:30", "America/New_York"),
    null
  );
});

test("zoned conversion rejects malformed and impossible local dates", () => {
  assert.equal(
    zonedDateTimeToIso("2026-02-30T09:00", "America/New_York"),
    null
  );
  assert.equal(
    zonedDateTimeToIso("2026-07-15T09:00:00", "America/New_York"),
    null
  );
});

test("default slot advances by calendar day in New York timezone", () => {
  // 02:00 UTC on November 15 is still November 14 in New York.
  const result = defaultLocalSlot(new Date("2026-11-15T02:00:00.000Z"));

  assert.deepEqual(result, {
    start: "2026-11-15T09:00",
    end: "2026-11-15T09:30",
  });
});


export const DEFAULT_TIMEZONE = "America/New_York";
export const MIN_SLOT_MINUTES = 15;
export const MAX_SLOT_MINUTES = 120;
export const DEFAULT_SLOT_MINUTES = 30;
export const WORK_START_HOUR = 9;
export const WORK_END_HOUR = 17;

export const TIMEZONE_OPTIONS = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "UTC",
  "Europe/London",
] as const;

export const OCCUPYING_BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "needs_human",
] as const;

export type OccupyingBookingStatus = (typeof OCCUPYING_BOOKING_STATUSES)[number];

export function isOccupyingBooking(status: string): status is OccupyingBookingStatus {
  return (OCCUPYING_BOOKING_STATUSES as readonly string[]).includes(status);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function localParts(date: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

export function localDateKey(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function localMinutes(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  return p.hour * 60 + p.minute;
}

export function formatSlotRange(
  startIso: string,
  endIso: string,
  timeZone: string
): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${startIso} – ${endIso}`;
  }
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(start);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date}, ${time.format(start)} – ${time.format(end)} (${timeZone})`;
}

export function slotDurationMinutes(startIso: string, endIso: string): number | null {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 60_000);
}

export type SlotInput = {
  startTime: string;
  endTime: string;
  timezone: string;
};

function offsetMs(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - date.getTime();
}

// Converts a datetime-local value into a UTC instant.
//
// Nonexistent local times (spring-forward gaps) and ambiguous local times
// (fall-back overlaps) are rejected instead of silently normalized.
export function zonedDateTimeToIso(
  localDateTime: string,
  timeZone: string
): string | null {
  if (!isValidTimeZone(timeZone)) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(
    localDateTime
  );
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);

  const desired = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(desired);

  // Date.UTC normalizes invalid dates, so verify the original components.
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute
  ) {
    return null;
  }

  const candidates = new Set<number>();

  // Sample offsets on both sides of nearby timezone transitions.
  // This captures both offsets during a fall-back overlap.
  for (let deltaHours = -48; deltaHours <= 48; deltaHours += 3) {
    const sample = new Date(desired + deltaHours * 60 * 60 * 1_000);
    const offset = offsetMs(sample, timeZone);
    const candidate = desired - offset;
    const actual = localParts(new Date(candidate), timeZone);

    if (
      actual.year === year &&
      actual.month === month &&
      actual.day === day &&
      actual.hour === hour &&
      actual.minute === minute
    ) {
      candidates.add(candidate);
    }
  }

  // Exactly one matching instant is required.
  if (candidates.size !== 1) return null;

  return new Date([...candidates][0]).toISOString();
}

export function defaultLocalSlot(date: Date = new Date()): {
  start: string;
  end: string;
} {
  const current = localParts(date, DEFAULT_TIMEZONE);

  // Advance one calendar day in the configured timezone, not 24 elapsed hours.
  const nextDay = new Date(
    Date.UTC(current.year, current.month - 1, current.day + 1)
  );

  const y = nextDay.getUTCFullYear();
  const m = String(nextDay.getUTCMonth() + 1).padStart(2, "0");
  const d = String(nextDay.getUTCDate()).padStart(2, "0");

  return {
    start: `${y}-${m}-${d}T09:00`,
    end: `${y}-${m}-${d}T09:30`,
  };
}

export type ValidationResult = { ok: boolean; errors: string[] };

export function validateSlotInput(
  input: SlotInput,
  now: Date = new Date()
): ValidationResult {
  const errors: string[] = [];
  const start = Date.parse(input.startTime);
  const end = Date.parse(input.endTime);

  if (Number.isNaN(start) || Number.isNaN(end)) {
    return { ok: false, errors: ["Start and end must be valid date-times."] };
  }
  if (!isValidTimeZone(input.timezone)) {
    errors.push("Choose a valid IANA timezone.");
    return { ok: false, errors };
  }
  if (end <= start) errors.push("The end time must be after the start time.");

  const duration = Math.round((end - start) / 60_000);
  if (duration < MIN_SLOT_MINUTES || duration > MAX_SLOT_MINUTES) {
    errors.push(
      `Slot length must be between ${MIN_SLOT_MINUTES} and ${MAX_SLOT_MINUTES} minutes.`
    );
  }
  if (start <= now.getTime()) errors.push("The slot must start in the future.");

  const startDate = localDateKey(new Date(start), input.timezone);
  const endDate = localDateKey(new Date(end), input.timezone);
  if (startDate !== endDate) {
    errors.push("A slot must start and end on the same local day.");
  }

  const startMinutes = localMinutes(new Date(start), input.timezone);
  const endMinutes = localMinutes(new Date(end), input.timezone);
  if (startMinutes < WORK_START_HOUR * 60 || endMinutes > WORK_END_HOUR * 60) {
    errors.push(
      `Slots must fit between ${WORK_START_HOUR}:00 and ${WORK_END_HOUR}:00 local time.`
    );
  }

  return { ok: errors.length === 0, errors };
}

export function validateBookingInput(input: {
  prospectName: string;
  prospectEmail: string;
  timezone: string;
}): ValidationResult {
  const errors: string[] = [];
  if (!input.prospectName.trim()) errors.push("A prospect name is required.");
  if (!/^\S+@\S+\.\S+$/.test(input.prospectEmail.trim())) {
    errors.push("A valid prospect email is required.");
  }
  if (!isValidTimeZone(input.timezone)) errors.push("Choose a valid IANA timezone.");
  return { ok: errors.length === 0, errors };
}

export function activeBookingForSlot<T extends { slot_id: string | null; status: string }>(
  bookings: T[],
  slotId: string
): T | null {
  return (
    bookings.find(
      (booking) =>
        booking.slot_id === slotId && isOccupyingBooking(booking.status)
    ) ?? null
  );
}

export function canDeleteSlot(
  bookings: { slot_id: string | null; status: string }[],
  slotId: string
): boolean {
  return activeBookingForSlot(bookings, slotId) === null;
}
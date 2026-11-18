"use client";

import { useMemo, useState } from "react";
import { DEFAULT_TIMEZONE, TIMEZONE_OPTIONS, localDateKey } from "@/lib/calendar/time";

export type CalendarBookingEvent = {
  id: string;
  startTime: string;
  endTime: string;
  timezone: string;
  status: string;
  prospectName: string | null;
  prospectEmail: string;
  companyName: string | null;
};

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1, 12)));
}

function shiftMonth(key: string, amount: number) {
  const [year, month] = key.split("-").map(Number);
  return monthKey(new Date(Date.UTC(year, month - 1 + amount, 1)));
}

function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
}

function statusTone(status: string) {
  if (status === "confirmed") return "bg-emerald-300";
  if (status === "needs_human") return "bg-amber-300";
  return "bg-cyan-300";
}

export default function CalendarMonthView({
  events,
  initialDate,
  initialTimezone,
  currentInstant,
}: {
  events: CalendarBookingEvent[];
  initialDate: string;
  initialTimezone: string;
  currentInstant: string;
}) {
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [timezone, setTimezone] = useState(initialTimezone || DEFAULT_TIMEZONE);
  const [visibleMonth, setVisibleMonth] = useState(initialDate.slice(0, 7));

  const timezoneOptions = useMemo(
    () => [...new Set([...TIMEZONE_OPTIONS, ...events.map((event) => event.timezone), timezone])].sort(),
    [events, timezone]
  );

  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, CalendarBookingEvent[]>();
    for (const event of events) {
      const key = localDateKey(new Date(event.startTime), timezone);
      grouped.set(key, [...(grouped.get(key) ?? []), event]);
    }
    for (const dayEvents of grouped.values()) {
      dayEvents.sort((a, b) => a.startTime.localeCompare(b.startTime));
    }
    return grouped;
  }, [events, timezone]);

  const calendarDays = useMemo(() => {
    const [year, month] = visibleMonth.split("-").map(Number);
    const first = new Date(Date.UTC(year, month - 1, 1));
    const mondayOffset = (first.getUTCDay() + 6) % 7;
    const gridStart = new Date(Date.UTC(year, month - 1, 1 - mondayOffset));
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(gridStart);
      day.setUTCDate(gridStart.getUTCDate() + index);
      return day.toISOString().slice(0, 10);
    });
  }, [visibleMonth]);

  const selectedEvents = eventsByDate.get(selectedDate) ?? [];
  const today = localDateKey(new Date(currentInstant), timezone);

  function chooseMonth(nextMonth: string) {
    setVisibleMonth(nextMonth);
    setSelectedDate(`${nextMonth}-01`);
  }

  function goToToday() {
    setVisibleMonth(today.slice(0, 7));
    setSelectedDate(today);
  }

  return (
    <section className="calendar-overview rounded-2xl border p-4 sm:p-5 md:p-6" aria-label="Upcoming bookings calendar">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[.2em] text-cyan-200/60">Schedule</div>
          <h2 className="text-xl font-semibold">{monthLabel(visibleMonth)}</h2>
          <p className="mt-1 text-xs text-slate-400">Upcoming active bookings · {events.length} total</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="booking-calendar-timezone">Calendar timezone</label>
          <select
            id="booking-calendar-timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className="calendar-timezone rounded-lg border px-2.5 py-2 text-xs"
          >
            {timezoneOptions.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
          <button type="button" onClick={() => chooseMonth(shiftMonth(visibleMonth, -1))} aria-label="Previous month" className="calendar-nav-button rounded-lg border px-3 py-2 text-sm">‹</button>
          <button type="button" onClick={goToToday} className="calendar-nav-button rounded-lg border px-3 py-2 text-xs font-semibold">Today</button>
          <button type="button" onClick={() => chooseMonth(shiftMonth(visibleMonth, 1))} aria-label="Next month" className="calendar-nav-button rounded-lg border px-3 py-2 text-sm">›</button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-white/10 pb-2 text-center text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">
        {weekdays.map((day) => <div key={day}>{day}</div>)}
      </div>

      <div className="grid grid-cols-7">
        {calendarDays.map((date) => {
          const dayEvents = eventsByDate.get(date) ?? [];
          const inMonth = date.slice(0, 7) === visibleMonth;
          const active = date === selectedDate;
          const dayNumber = Number(date.slice(-2));
          return (
            <button
              key={date}
              type="button"
              onClick={() => setSelectedDate(date)}
              aria-label={`${date}, ${dayEvents.length} booking${dayEvents.length === 1 ? "" : "s"}`}
              aria-pressed={active}
              className={`calendar-day min-h-[68px] border-b border-r p-1.5 text-left sm:min-h-[96px] sm:p-2 ${active ? "is-selected" : ""} ${inMonth ? "" : "is-outside"}`}
            >
              <span className={`calendar-day-number flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${date === today ? "is-today" : ""}`}>
                {dayNumber}
              </span>
              {dayEvents.length > 0 && <span className="calendar-day-count mt-1 block text-[9px] sm:hidden">{dayEvents.length} booking{dayEvents.length === 1 ? "" : "s"}</span>}
              <span className="mt-1 hidden space-y-1 sm:block">
                {dayEvents.slice(0, 2).map((event) => (
                  <span key={event.id} className="calendar-event-preview flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px] leading-tight">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusTone(event.status)}`} />
                    <span className="truncate">{formatTime(event.startTime, timezone)} · {event.companyName ?? event.prospectName ?? event.prospectEmail}</span>
                  </span>
                ))}
                {dayEvents.length > 2 && <span className="block px-1.5 text-[9px] text-cyan-100/60">+{dayEvents.length - 2} more</span>}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 border-t border-white/10 pt-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-100">{new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${selectedDate}T12:00:00Z`))}</h3>
          <div className="flex items-center gap-3 text-[10px] text-slate-400">
            <span className="flex items-center gap-1.5"><i className="h-1.5 w-1.5 rounded-full bg-cyan-300" />Pending</span>
            <span className="flex items-center gap-1.5"><i className="h-1.5 w-1.5 rounded-full bg-emerald-300" />Confirmed</span>
            <span className="flex items-center gap-1.5"><i className="h-1.5 w-1.5 rounded-full bg-amber-300" />Needs human</span>
          </div>
        </div>
        {selectedEvents.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-white/[.025] px-4 py-3 text-xs text-slate-400">No upcoming bookings on this day.</p>
        ) : (
          <ul className="grid gap-2 lg:grid-cols-2">
            {selectedEvents.map((event) => (
              <li key={event.id} className="calendar-event-detail flex min-w-0 items-center gap-3 rounded-xl border px-3 py-3">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusTone(event.status)}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-100">{event.companyName ?? event.prospectName ?? "Prospect"}</div>
                  <div className="truncate text-xs text-slate-400">{event.prospectEmail} · <span className="capitalize">{event.status.replaceAll("_", " ")}</span></div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold text-cyan-100">{formatTime(event.startTime, timezone)} – {formatTime(event.endTime, timezone)}</div>
                  <div className="text-[10px] text-slate-500">{timezone}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSlot } from "@/app/(dashboard)/calendar/actions";
import {
  DEFAULT_TIMEZONE,
  TIMEZONE_OPTIONS,
  defaultLocalSlot,
  zonedDateTimeToIso,
} from "@/lib/calendar/time";

export default function SlotCreator() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const initial = defaultLocalSlot();
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const startIso = zonedDateTimeToIso(start, timezone);
    const endIso = zonedDateTimeToIso(end, timezone);
    if (!startIso || !endIso) {
      setError("Enter a valid start and end date-time.");
      return;
    }
    startTransition(async () => {
      const result = await createSlot({
        startTime: startIso,
        endTime: endIso,
        timezone,
      });
      if (!result.ok) {
        setError(result.error ?? "The slot could not be created.");
        return;
      }
      setNotice(result.message ?? "Slot created.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded border bg-white p-4">
      <h3 className="font-medium">Add internal slot</h3>
      <p className="text-xs text-gray-500">
        Defaults to a 30-minute slot inside 9:00–17:00 local time. Durations from 15 to
        120 minutes are accepted. Internal slots work without Google credentials.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs">
          <span className="font-medium text-gray-700">Start</span>
          <input
            type="datetime-local"
            required
            value={start}
            onChange={(event) => setStart(event.target.value)}
            className="w-full rounded border px-2 py-1.5 text-sm"
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium text-gray-700">End</span>
          <input
            type="datetime-local"
            required
            value={end}
            onChange={(event) => setEnd(event.target.value)}
            className="w-full rounded border px-2 py-1.5 text-sm"
          />
        </label>
        <label className="space-y-1 text-xs sm:col-span-2">
          <span className="font-medium text-gray-700">Timezone</span>
          <select
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className="w-full rounded border px-2 py-1.5 text-sm"
          >
            {TIMEZONE_OPTIONS.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
      {notice && <p className="text-xs text-green-700">{notice}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        {pending ? "Creating..." : "Create slot"}
      </button>
    </form>
  );
}
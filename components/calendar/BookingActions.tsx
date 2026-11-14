"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cancelBooking,
  confirmBooking,
  rescheduleBooking,
} from "@/app/(dashboard)/calendar/actions";

type SlotOption = { id: string; label: string };

export default function BookingActions({
  bookingId,
  status,
  currentSlotId,
  slots,
}: {
  bookingId: string;
  status: string;
  currentSlotId: string | null;
  slots: SlotOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"cancel" | "reschedule" | null>(null);
  const [reason, setReason] = useState("");
  const [newSlotId, setNewSlotId] = useState(
    slots.find((slot) => slot.id !== currentSlotId)?.id ?? ""
  );
  const [error, setError] = useState<string | null>(null);

  const active =
    status === "pending" || status === "confirmed" || status === "needs_human";

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "The action failed.");
        return;
      }
      setMode(null);
      setReason("");
      router.refresh();
    });
  }

  if (!active) {
    return <span className="text-xs text-gray-500">No actions</span>;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {(status === "pending" || status === "needs_human") && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => confirmBooking(bookingId))}
            className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            Confirm
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => setMode(mode === "cancel" ? null : "cancel")}
          className="rounded border px-2 py-1 text-xs disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={pending || slots.length === 0}
          onClick={() => setMode(mode === "reschedule" ? null : "reschedule")}
          className="rounded border px-2 py-1 text-xs disabled:opacity-50"
        >
          Reschedule
        </button>
      </div>

      {error && <p className="text-xs text-red-700">{error}</p>}

      {mode === "cancel" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run(() => cancelBooking(bookingId, reason));
          }}
          className="space-y-1 rounded bg-red-50 p-2"
        >
          <textarea
            required
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Cancellation reason"
            className="w-full rounded border px-2 py-1 text-xs"
          />
          <button
            type="submit"
            disabled={pending || !reason.trim()}
            className="rounded bg-red-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            Cancel booking
          </button>
        </form>
      )}

      {mode === "reschedule" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run(() => rescheduleBooking(bookingId, newSlotId, reason));
          }}
          className="space-y-1 rounded bg-blue-50 p-2"
        >
          <select
            value={newSlotId}
            onChange={(event) => setNewSlotId(event.target.value)}
            className="w-full rounded border px-2 py-1 text-xs"
          >
            {slots
              .filter((slot) => slot.id !== currentSlotId)
              .map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {slot.label}
                </option>
              ))}
          </select>
          <textarea
            required
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reschedule reason"
            className="w-full rounded border px-2 py-1 text-xs"
          />
          <button
            type="submit"
            disabled={pending || !reason.trim() || !newSlotId}
            className="rounded bg-blue-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            Reschedule
          </button>
        </form>
      )}
    </div>
  );
}
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSlot } from "@/app/(dashboard)/calendar/actions";

export default function SlotDeleteButton({
  slotId,
  disabled,
}: {
  slotId: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={pending || disabled}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await deleteSlot(slotId);
            if (!result.ok) {
              setError(result.error ?? "The slot could not be deleted.");
              return;
            }
            router.refresh();
          })
        }
        className="rounded border px-2 py-1 text-xs disabled:opacity-40"
        title={disabled ? "Cancel or reschedule the active booking first" : "Delete slot"}
      >
        {pending ? "Deleting..." : "Delete"}
      </button>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
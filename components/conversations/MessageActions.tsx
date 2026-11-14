"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveAiMessage,
  discardAiMessage,
  type ConversationActionResult,
} from "@/app/(dashboard)/conversations/actions";

export default function MessageActions({ messageId }: { messageId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<ConversationActionResult>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "The action failed.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-2 space-y-1">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => approveAiMessage(messageId))}
          className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          Approve draft
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => discardAiMessage(messageId))}
          className="rounded border px-2 py-1 text-xs disabled:opacity-50"
        >
          Discard
        </button>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
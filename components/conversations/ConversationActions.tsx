"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addProspectReply,
  closeConversation,
  resolveBookingRequest,
  sendHumanReply,
  suppressConversation,
  takeoverConversation,
  type ConversationActionResult,
} from "@/app/(dashboard)/conversations/actions";

type Props = {
  conversationId: string;
  companyId: string;
  status: string;
  bookingRequest: boolean;
};

type Mode = "inbound" | "human" | "suppress" | null;

export default function ConversationActions({
  conversationId,
  companyId,
  status,
  bookingRequest,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>(null);
  const [body, setBody] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const locked = status === "suppressed";

  function run(action: () => Promise<ConversationActionResult>) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "The action failed.");
        return;
      }
      setMode(null);
      setBody("");
      setReason("");
      setNotice(result.message ?? "Done.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && (
        <p className="rounded bg-green-50 p-3 text-sm text-green-800">{notice}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || locked || status === "human_takeover"}
          onClick={() => run(() => takeoverConversation(conversationId))}
          className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          Take over thread
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setMode(mode === "inbound" ? null : "inbound")}
          className="rounded border px-3 py-1.5 text-xs disabled:opacity-50"
        >
          Add simulated prospect reply
        </button>
        {!locked && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setMode(mode === "human" ? null : "human")}
            className="rounded border px-3 py-1.5 text-xs disabled:opacity-50"
          >
            Write human reply
          </button>
        )}
        {bookingRequest && (
          <Link
            href={`/calendar?conversation=${conversationId}&company=${companyId}`}
            className="rounded bg-blue-700 px-3 py-1.5 text-xs font-medium text-white"
          >
            Open booking calendar
          </Link>
        )}
        {bookingRequest && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => resolveBookingRequest(conversationId))}
            className="rounded border px-3 py-1.5 text-xs disabled:opacity-50"
          >
            Clear booking request
          </button>
        )}
        {!locked && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => closeConversation(conversationId))}
            className="rounded border px-3 py-1.5 text-xs disabled:opacity-50"
          >
            Close conversation
          </button>
        )}
        {!locked && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setMode(mode === "suppress" ? null : "suppress")}
            className="rounded border border-red-300 px-3 py-1.5 text-xs text-red-700 disabled:opacity-50"
          >
            Suppress contact
          </button>
        )}
      </div>

      {locked && (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          This contact is permanently suppressed. Messages can be recorded, but no reply
          may be sent.
        </p>
      )}

      {mode === "inbound" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run(() => addProspectReply(conversationId, body));
          }}
          className="space-y-2 rounded border bg-white p-3"
        >
          <label className="block text-xs font-medium text-gray-700">
            Simulated prospect message
          </label>
          <textarea
            required
            rows={4}
            maxLength={4_000}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className="w-full rounded border px-2 py-1 text-sm"
            placeholder="Paste a reply you want the agent to handle..."
          />
          <button
            type="submit"
            disabled={pending || !body.trim()}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {pending ? "Processing..." : "Process prospect reply"}
          </button>
        </form>
      )}

      {mode === "human" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run(() => sendHumanReply(conversationId, body));
          }}
          className="space-y-2 rounded border bg-white p-3"
        >
          <label className="block text-xs font-medium text-gray-700">
            Human reply (simulated send)
          </label>
          <textarea
            required
            rows={4}
            maxLength={4_000}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className="w-full rounded border px-2 py-1 text-sm"
            placeholder="Write the reply as the salesperson..."
          />
          <button
            type="submit"
            disabled={pending || !body.trim()}
            className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {pending ? "Saving..." : "Record reply"}
          </button>
        </form>
      )}

      {mode === "suppress" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run(() => suppressConversation(conversationId, reason));
          }}
          className="space-y-2 rounded border border-red-200 bg-red-50 p-3"
        >
          <label className="block text-xs font-medium text-red-900">
            Why is this contact being permanently suppressed?
          </label>
          <textarea
            required
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="w-full rounded border px-2 py-1 text-sm"
            placeholder="Prospect asked not to be contacted..."
          />
          <button
            type="submit"
            disabled={pending || !reason.trim()}
            className="rounded bg-red-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {pending ? "Suppressing..." : "Suppress permanently"}
          </button>
        </form>
      )}
    </div>
  );
}
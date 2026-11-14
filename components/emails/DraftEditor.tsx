"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveDraft,
  rejectDraft,
  requestDraftRevision,
  saveDraft,
  simulateSendDraft,
  suppressFromDraft,
  type EmailActionResult,
} from "@/app/(dashboard)/emails/actions";

type Props = {
  draftId: string;
  status: string;
  subject: string;
  body: string;
  revisionNote: string | null;
};

export default function DraftEditor({
  draftId,
  status,
  subject,
  body,
  revisionNote,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [subjectValue, setSubjectValue] = useState(subject);
  const [bodyValue, setBodyValue] = useState(body);
  const [mode, setMode] = useState<"reject" | "revision" | "suppress" | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const locked = status === "sent_simulated" || status === "sent";
  const dirty = subjectValue !== subject || bodyValue !== body;

  function run(action: () => Promise<EmailActionResult>, message?: string) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "The action failed.");
        return;
      }
      setMode(null);
      setNote("");
      if (result.conversationId) {
        router.push(`/conversations/${result.conversationId}`);
        return;
      }
      setSuccess(message ?? "Saved.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {revisionNote && (
        <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <b>Latest revision note:</b> {revisionNote}
        </p>
      )}

      <label className="block space-y-1">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Subject
        </span>
        <input
          value={subjectValue}
          onChange={(event) => setSubjectValue(event.target.value)}
          disabled={locked || pending}
          maxLength={120}
          className="w-full rounded border bg-white px-3 py-2 text-sm disabled:bg-gray-100"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Body
        </span>
        <textarea
          value={bodyValue}
          onChange={(event) => setBodyValue(event.target.value)}
          disabled={locked || pending}
          rows={14}
          maxLength={4_000}
          className="w-full rounded border bg-white px-3 py-2 text-sm leading-6 disabled:bg-gray-100"
        />
      </label>

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && (
        <p className="rounded bg-green-50 p-3 text-sm text-green-800">{success}</p>
      )}

      {!locked && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending || !dirty}
            onClick={() =>
              run(
                () => saveDraft(draftId, subjectValue, bodyValue),
                "Draft saved and moved back to needs review."
              )
            }
            className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Save edit
          </button>
          {(status === "draft" || status === "needs_review") && (
            <button
              type="button"
              disabled={pending || dirty}
              onClick={() => run(() => approveDraft(draftId), "Draft approved.")}
              className="rounded bg-green-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Approve
            </button>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => setMode(mode === "reject" ? null : "reject")}
            className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
          >
            Reject
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setMode(mode === "revision" ? null : "revision")}
            className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Request revision
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setMode(mode === "suppress" ? null : "suppress")}
            className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
          >
            Suppress contact
          </button>
        </div>
      )}

      {status === "approved" && (
        <div className="rounded border border-blue-200 bg-blue-50 p-3 space-y-2">
          <p className="text-sm text-blue-900">
            This will be recorded as <b>Simulated send: demo path</b>. No real email
            is sent.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => simulateSendDraft(draftId))}
            className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? "Working..." : "Simulate send"}
          </button>
        </div>
      )}

      {mode === "reject" && (
        <NoteForm
          label="Why is this draft being rejected?"
          value={note}
          onChange={setNote}
          pending={pending}
          submitLabel="Save rejection"
          onSubmit={() => run(() => rejectDraft(draftId, note), "Draft rejected.")}
        />
      )}
      {mode === "revision" && (
        <NoteForm
          label="What should the revision change?"
          value={note}
          onChange={setNote}
          pending={pending}
          submitLabel="Generate revision"
          onSubmit={() =>
            run(() => requestDraftRevision(draftId, note), "Revision generated.")
          }
        />
      )}
      {mode === "suppress" && (
        <NoteForm
          label="Why should this contact be permanently suppressed?"
          value={note}
          onChange={setNote}
          pending={pending}
          submitLabel="Suppress contact"
          onSubmit={() =>
            run(() => suppressFromDraft(draftId, note), "Contact suppressed permanently.")
          }
        />
      )}
    </div>
  );
}

function NoteForm({
  label,
  value,
  onChange,
  pending,
  submitLabel,
  onSubmit,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  pending: boolean;
  submitLabel: string;
  onSubmit: () => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="space-y-2 rounded border bg-white p-3"
    >
      <label className="block text-xs font-medium text-gray-700">{label}</label>
      <textarea
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        maxLength={1_000}
        className="w-full rounded border px-2 py-1 text-sm"
      />
      <button
        type="submit"
        disabled={pending || !value.trim()}
        className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        {pending ? "Working..." : submitLabel}
      </button>
    </form>
  );
}
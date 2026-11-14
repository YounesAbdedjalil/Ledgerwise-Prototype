"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  rejectSource,
  resetSourceToPending,
  verifySource,
  type SourceActionResult,
} from "@/app/(dashboard)/prospects/source-actions";
import { isHttpUrl } from "@/lib/validation";
import SourceStatusBadge from "./SourceStatusBadge";

export type SourceReviewRow = {
  id: string;
  company_id: string;
  claim: string;
  claim_type: string;
  source_url: string;
  source_title: string;
  retrieved_at: string;
  evidence: string;
  verification_status: string;
  imported_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  verification_note: string | null;
  created_at: string;
  companies?:
    | { name: string; website: string }
    | { name: string; website: string }[]
    | null;
};

function companyOf(row: SourceReviewRow): { name: string; website: string } | null {
  if (!row.companies) return null;
  return Array.isArray(row.companies) ? row.companies[0] ?? null : row.companies;
}

function shortDate(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 10);
}

export default function SourceReviewTable({
  rows,
  showCompany = false,
}: {
  rows: SourceReviewRow[];
  showCompany?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded border bg-white p-4 text-sm text-gray-600">
        No sources to show.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <SourceReviewCard key={row.id} row={row} showCompany={showCompany} />
      ))}
    </div>
  );
}

function SourceReviewCard({
  row,
  showCompany,
}: {
  row: SourceReviewRow;
  showCompany: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"reject" | "reset" | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const company = companyOf(row);

  function run(action: () => Promise<SourceActionResult>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "The action failed.");
        return;
      }
      setMode(null);
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="rounded border bg-white p-4 text-sm space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          {showCompany && company && (
            <div className="font-medium">
              {company.name}{" "}
              <span className="text-xs font-normal text-gray-500">
                {company.website.replace(/^https?:\/\//, "")}
              </span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
              {row.claim_type}
            </span>
            <SourceStatusBadge status={row.verification_status} />
            {row.verification_status === "pending_review" && (
              <span className="text-xs text-amber-700">
                Imported and structurally valid, not yet human-verified.
              </span>
            )}
          </div>
        </div>
        <div className="text-xs text-gray-500 text-right">
          <div>Retrieved {row.retrieved_at}</div>
          {row.reviewed_at && (
            <div>
              Reviewed by a team member on {shortDate(row.reviewed_at)}
            </div>
          )}
        </div>
      </div>

      <div>
        <p className="font-medium">{row.claim}</p>
        <p className="mt-1 text-gray-700">
          <span className="text-gray-500">Evidence: </span>
          {row.evidence}
        </p>
      </div>

      <div className="text-xs">
        {isHttpUrl(row.source_url) ? (
          <a
            href={row.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 underline"
          >
            {row.source_title || row.source_url}
          </a>
        ) : (
          <span className="text-red-700">Source URL is not usable: {row.source_url}</span>
        )}
      </div>

      {row.verification_status === "rejected" && row.verification_note && (
        <p className="rounded bg-red-50 p-2 text-xs text-red-800">
          Rejection note: {row.verification_note}
        </p>
      )}

      {error && (
        <p className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {row.verification_status !== "verified" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => verifySource(row.id))}
            className="rounded bg-green-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {pending ? "Working..." : "Mark verified"}
          </button>
        )}
        {row.verification_status !== "rejected" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setMode(mode === "reject" ? null : "reject")}
            className="rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
          >
            Reject
          </button>
        )}
        {row.verification_status === "rejected" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setMode(mode === "reject" ? null : "reject")}
            className="rounded border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            Update rejection note
          </button>
        )}
        {(row.verification_status === "verified" ||
          row.verification_status === "rejected") && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setMode(mode === "reset" ? null : "reset")}
            className="rounded border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            Reset to pending
          </button>
        )}
      </div>

      {mode === "reject" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run(() => rejectSource(row.id, note));
          }}
          className="space-y-2 rounded bg-red-50 p-3"
        >
          <label className="block text-xs font-medium text-red-900">
            Why is this source not usable?
          </label>
          <textarea
            required
            maxLength={1000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            className="w-full rounded border px-2 py-1 text-sm"
            placeholder="The claim is not supported by the evidence..."
          />
          <button
            type="submit"
            disabled={pending || !note.trim()}
            className="rounded bg-red-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            Save rejection
          </button>
        </form>
      )}

      {mode === "reset" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run(() => resetSourceToPending(row.id, note));
          }}
          className="space-y-2 rounded bg-gray-50 p-3"
        >
          <label className="block text-xs font-medium text-gray-800">
            Why are you resetting this review?
          </label>
          <textarea
            required
            maxLength={1000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            className="w-full rounded border px-2 py-1 text-sm"
            placeholder="Re-checking the source after a correction..."
          />
          <button
            type="submit"
            disabled={pending || !note.trim()}
            className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            Reset to pending
          </button>
        </form>
      )}
    </div>
  );
}
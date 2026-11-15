"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TARGET = 30;
// Each request is capped by the server's time budget (about 3 minutes of
// work). The button chains requests until the target is met or progress stalls.
const MAX_REQUESTS = 6;

type DiscoveryResponse = {
  error?: string;
  imported?: number;
  remaining?: number;
  stopReason?: string;
  canContinue?: boolean;
  negativeCache?: "active" | "unavailable";
  sourcesAdded?: number;
  importError?: string | null;
  searchFailures?: number;
  funnel?: {
    researched: number;
    qualified: number;
    newCandidates: number;
    byStage: Record<string, number>;
  };
};

type Totals = {
  requests: number;
  imported: number;
  researched: number;
  sourcesAdded: number;
  searchFailures: number;
  byStage: Record<string, number>;
  stopReason: string;
  importError: string | null;
  negativeCache: "active" | "unavailable";
};

const STAGE_LABELS: Record<string, string> = {
  complete: "Qualified",
  eligibility: "Not a storefront (or a service business)",
  early_service: "Service business (homepage)",
  no_us_signal: "No US wording on the site",
  us_evidence: "No verified US evidence",
  fetch: "Website could not be read",
  extraction: "AI extraction failed",
  ai_unavailable: "AI provider unavailable",
  no_claims: "No usable claims",
};

const STOP_LABELS: Record<string, string> = {
  target_reached: "Target reached.",
  deadline: "Stopped at the time limit; run again to continue.",
  research_limit: "Stopped at the per-request research limit; run again to continue.",
  candidates_exhausted: "Ran out of new candidate websites for this batch of queries.",
  search_failed: "Search requests failed. Check TAVILY_API_KEY and quota.",
  ai_unavailable: "The AI provider is rate-limited or unavailable. Try again shortly.",
  import_failed: "Saving to the database failed.",
};

export default function DiscoverCompaniesButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [totals, setTotals] = useState<Totals | null>(null);

  async function discover() {
    setLoading(true);
    setError("");
    setTotals(null);

    const acc: Totals = {
      requests: 0, imported: 0, researched: 0, sourcesAdded: 0, searchFailures: 0,
      byStage: {}, stopReason: "", importError: null, negativeCache: "active",
    };
    let stalled = 0;

    try {
      while (acc.requests < MAX_REQUESTS && acc.imported < TARGET) {
        setProgress(
          `Request ${acc.requests + 1}: ${acc.imported}/${TARGET} companies imported so far...`
        );

        const response = await fetch("/api/prospects/discover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: TARGET - acc.imported }),
        });
        const data: DiscoveryResponse = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Discovery failed.");

        acc.requests++;
        acc.imported += data.imported ?? 0;
        acc.researched += data.funnel?.researched ?? 0;
        acc.sourcesAdded += data.sourcesAdded ?? 0;
        acc.searchFailures += data.searchFailures ?? 0;
        acc.stopReason = data.stopReason ?? "";
        acc.importError = data.importError ?? acc.importError;
        acc.negativeCache = data.negativeCache ?? acc.negativeCache;
        for (const [stage, n] of Object.entries(data.funnel?.byStage ?? {})) {
          acc.byStage[stage] = (acc.byStage[stage] ?? 0) + n;
        }
        setTotals({ ...acc, byStage: { ...acc.byStage } });

        stalled = (data.imported ?? 0) === 0 ? stalled + 1 : 0;
        if (!data.canContinue || stalled >= 2) break;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discovery failed.");
      if (acc.requests > 0) router.refresh(); // earlier requests already saved companies
    } finally {
      setLoading(false);
      setProgress("");
    }
  }

  const stages = totals
    ? Object.entries(totals.byStage).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={discover}
        disabled={loading}
        className="rounded-lg bg-[#174f85] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123e6a] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Searching and researching..." : `Discover ${TARGET} Companies`}
      </button>

      {loading && (
        <p role="status" className="max-w-sm text-xs text-slate-500">
          {progress} Ledgerwise keeps searching for replacements whenever a
          candidate is rejected. This can take several minutes.
        </p>
      )}

      {error && (
        <p role="alert" className="max-w-sm text-xs text-red-600">{error}</p>
      )}

      {totals && (
        <div className="max-w-md rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
          <p className="font-semibold text-slate-800">
            {totals.imported} of {TARGET} companies imported
          </p>
          <p className="mt-1">
            {totals.researched} websites researched · {totals.sourcesAdded} evidence
            records added for human review.
          </p>
          {totals.stopReason && !loading && (
            <p className="mt-1">{STOP_LABELS[totals.stopReason] ?? totals.stopReason}</p>
          )}
          {stages.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {stages.map(([stage, n]) => (
                <li key={stage} className="flex justify-between gap-4">
                  <span>{STAGE_LABELS[stage] ?? stage}</span>
                  <span className="tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          )}
          {(totals.searchFailures || totals.importError || totals.negativeCache === "unavailable") ? (
            <p className="mt-2 text-amber-700">
              {totals.searchFailures ? `${totals.searchFailures} search failures. ` : ""}
              {totals.importError ? `${totals.importError} ` : ""}
              {totals.negativeCache === "unavailable"
                ? "Rejected sites are not being remembered: apply migration 06 so repeat runs skip them."
                : ""}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

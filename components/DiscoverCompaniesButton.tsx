"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type DiscoveryResult = {
  error?: string;
  candidatesFound?: number;
  researched?: number;
  companiesWithEvidence?: number;
  companiesCreated?: number;
  sourcesAdded?: number;
  duplicatesSkipped?: number;
  rejected?: number;
  searchFailures?: number;
  importError?: string | null;
};

export default function DiscoverCompaniesButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DiscoveryResult | null>(null);

  async function discover() {
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/prospects/discover", {
        method: "POST",
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Discovery failed.");
      }

      setResult(data);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discovery failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={discover}
        disabled={loading}
        className="rounded-lg bg-[#174f85] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123e6a] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Searching and researching..." : "Discover 30 Companies"}
      </button>

      {loading && (
        <p role="status" className="text-xs text-slate-500">
          Tavily is finding companies. Ledgerwise is researching their websites
          and checking evidence. This may take a few minutes.
        </p>
      )}

      {error && (
        <p role="alert" className="max-w-sm text-xs text-red-600">{error}</p>
      )}

      {result && (
        <div className="max-w-md rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
          <p className="font-semibold text-slate-800">Discovery completed</p>
          <p className="mt-1">
            {result.researched ?? 0} researched ·{" "}
            {result.companiesWithEvidence ?? 0} with evidence ·{" "}
            {result.companiesCreated ?? 0} companies created
          </p>
          <p>
            {result.sourcesAdded ?? 0} evidence records added for human review.
          </p>
          {(result.rejected || result.searchFailures || result.importError) ? (
            <p className="mt-1 text-amber-700">
              {result.rejected ?? 0} import issues ·{" "}
              {result.searchFailures ?? 0} search failures
              {result.importError ? ` · ${result.importError}` : ""}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

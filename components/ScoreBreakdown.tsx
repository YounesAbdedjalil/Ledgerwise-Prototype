import type { ScoreResult, SourceRow } from "@/lib/scoring/score";
import { isHttpUrl } from "@/lib/validation";
import SourceStatusBadge from "@/components/prospects/SourceStatusBadge";

export function SourceItem({ s }: { s: SourceRow }) {
  return (
    <li className="text-xs text-gray-600">
      {isHttpUrl(s.source_url) ? (
        <a
          href={s.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-700 underline"
        >
          {s.source_title}
        </a>
      ) : (
        <span className="text-red-700">
          {s.source_title || "Invalid source URL"}
        </span>
      )}{" "}
      · retrieved {s.retrieved_at}
      {s.verification_status && (
        <>
          {" "}
          <SourceStatusBadge status={s.verification_status} />
        </>
      )}
      <div>Evidence: {s.evidence}</div>
    </li>
  );
}

export default function ScoreBreakdown({ score }: { score: ScoreResult }) {
  return (
    <div className="space-y-4">
      {score.disqualifiers.length > 0 && (
        <div className="border border-red-300 bg-red-50 rounded p-4 space-y-2">
          <p className="text-sm font-medium text-red-800">
            Verified disqualifier evidence recorded. Review before any outreach.
          </p>
          <ul className="space-y-2">
            {score.disqualifiers.map((source) => (
              <li key={source.id} className="text-sm text-red-900">
                {source.claim}
                <ul className="mt-1">
                  <SourceItem s={source} />
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white border rounded p-4 text-sm flex flex-wrap items-center justify-between gap-2">
        {score.total === null ? (
          <span className="text-gray-600">
            Score not computed: weights are incomplete.
          </span>
        ) : (
          <span>
            Score: <b>{score.total}</b> / {score.maxTotal}
          </span>
        )}
        {score.provisional && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
            Provisional — evidence incomplete
          </span>
        )}
        {!score.provisional && (
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
            All criteria supported
          </span>
        )}
      </div>

      {score.criteria.map((result) => (
        <div
          key={result.criterion.key}
          className="bg-white border rounded p-4 space-y-2"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-medium">{result.criterion.label}</h3>
              <p className="text-xs text-gray-500">
                {result.criterion.measures}
              </p>
            </div>
            <div className="text-right text-xs shrink-0">
              <div>
                Weight: <b>{result.criterion.weight ?? "not set"}</b>
              </div>
              <div>
                Points: <b>{result.points ?? "n/a"}</b>
              </div>
              <div className={result.met ? "text-green-700" : "text-amber-700"}>
                {result.met ? "Verified evidence" : "Unknown"}
              </div>
            </div>
          </div>
          <p className="text-sm">
            <span className="text-gray-500">Reason: </span>
            {result.reason}
          </p>
          {result.sources.length > 0 && (
            <ul className="space-y-1 border-t pt-2">
              {result.sources.map((source) => (
                <SourceItem key={source.id} s={source} />
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

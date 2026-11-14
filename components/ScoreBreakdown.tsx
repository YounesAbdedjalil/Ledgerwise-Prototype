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
        <span className="text-red-700">{s.source_title || "Invalid source URL"}</span>
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
            Disqualifier evidence recorded. Review before any outreach.
          </p>
          <ul className="space-y-2">
            {score.disqualifiers.map((s) => (
              <li key={s.id} className="text-sm text-red-900">
                {s.claim}
                <ul className="mt-1">
                  <SourceItem s={s} />
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white border rounded p-4 text-sm">
        {score.total === null ? (
          <span className="text-gray-600">
            Score not computed: weights are not set yet.
          </span>
        ) : (
          <span>
            Score: <b>{score.total}</b> / {score.maxTotal}
          </span>
        )}
      </div>

      {score.criteria.map((r) => (
        <div key={r.criterion.key} className="bg-white border rounded p-4 space-y-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-medium">{r.criterion.label}</h3>
              <p className="text-xs text-gray-500">{r.criterion.measures}</p>
            </div>
            <div className="text-right text-xs shrink-0">
              <div>
                Weight:{" "}
                <b>{r.criterion.weight === null ? "not set" : r.criterion.weight}</b>
              </div>
              <div>
                Points: <b>{r.points === null ? "n/a" : r.points}</b>
              </div>
              <div className={r.met ? "text-green-700" : "text-gray-500"}>
                {r.met ? "Evidence found" : "Unknown"}
              </div>
            </div>
          </div>
          <p className="text-sm">
            <span className="text-gray-500">Reason: </span>
            {r.reason}
          </p>
          {r.sources.length > 0 && (
            <ul className="space-y-1 border-t pt-2">
              {r.sources.map((s) => (
                <SourceItem key={s.id} s={s} />
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

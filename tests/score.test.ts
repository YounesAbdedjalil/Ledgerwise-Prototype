import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreCompany, type SourceRow } from "../lib/scoring/score";
import { CRITERIA } from "../lib/scoring/config";

const src = (
  claim_type: string,
  claim: string,
  verification_status = "pending_review"
): SourceRow => ({
  id: `${claim_type}-${claim}`,
  claim,
  claim_type,
  source_url: "https://example.com/x",
  source_title: "Example source",
  retrieved_at: "2026-11-12",
  evidence: "Fixture evidence text",
  verification_status,
  reviewed_by: verification_status === "verified" ? "reviewer-1" : null,
  reviewed_at:
    verification_status === "verified" ? "2026-11-13T10:00:00.000Z" : null,
});

const allVerified = [
  src("us_ecommerce", "US shipping", "verified"),
  src("size_fit", "About $4M revenue, 12 staff", "verified"),
  src("contact", "Jane | Founder", "verified"),
  src("growth_signal", "Hiring bookkeeper", "verified"),
  src("pain_signal", "Multi-channel bookkeeping complexity", "verified"),
];

test("qualification weights match the approved 100-point rubric", () => {
  assert.deepEqual(
    CRITERIA.map((criterion) => criterion.weight),
    [30, 25, 15, 15, 15]
  );
  assert.equal(
    CRITERIA.reduce((sum, criterion) => sum + (criterion.weight ?? 0), 0),
    100
  );
});

test("all verified evidence earns the full 100 points", () => {
  const result = scoreCompany(allVerified);
  assert.equal(result.weightsComplete, true);
  assert.equal(result.total, 100);
  assert.equal(result.maxTotal, 100);
  assert.equal(result.provisional, false);
  assert.ok(result.criteria.every((criterion) => criterion.met));
});

test("pending evidence remains unknown and earns no points", () => {
  const result = scoreCompany([
    src("us_ecommerce", "US shipping", "pending_review"),
  ]);
  assert.equal(result.total, 0);
  assert.equal(result.provisional, true);
  assert.equal(result.criteria[0].met, false);
  assert.equal(result.criteria[0].points, 0);
  assert.equal(result.criteria[0].sources.length, 0);
  assert.match(result.criteria[0].reason, /not been human-verified/);
});

test("rejected evidence cannot earn points", () => {
  const result = scoreCompany([
    src("us_ecommerce", "US shipping", "rejected"),
  ]);
  assert.equal(result.criteria[0].points, 0);
  assert.equal(result.criteria[0].met, false);
  assert.equal(result.criteria[0].sources.length, 0);
});

test("partial verified evidence produces a provisional partial score", () => {
  const result = scoreCompany([
    src("us_ecommerce", "US shipping", "verified"),
  ]);
  assert.equal(result.total, 30);
  assert.equal(result.maxTotal, 100);
  assert.equal(result.provisional, true);
});

test("only human-verified sources are attached to criterion results", () => {
  const result = scoreCompany([
    src("us_ecommerce", "Verified US shipping", "verified"),
    src("us_ecommerce", "Pending US shipping", "pending_review"),
  ]);
  assert.equal(result.criteria[0].sources.length, 1);
  assert.equal(result.criteria[0].sources[0].claim, "Verified US shipping");
});

test("only verified disqualifiers are surfaced and they earn no points", () => {
  const result = scoreCompany([
    src("disqualifier", "Verified opt-out", "verified"),
    src("disqualifier", "Pending concern", "pending_review"),
  ]);
  assert.equal(result.disqualifiers.length, 1);
  assert.equal(result.disqualifiers[0].claim, "Verified opt-out");
  assert.equal(result.total, 0);
});

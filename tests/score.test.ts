import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreCompany, type SourceRow } from "../lib/scoring/score";
import { CRITERIA } from "../lib/scoring/config";

const src = (claim_type: string, claim: string): SourceRow => ({
  id: `${claim_type}-${claim}`,
  claim,
  claim_type,
  source_url: "https://example.com/x",
  source_title: "Title",
  retrieved_at: "2026-11-12",
  evidence: "Fixture evidence text",
});

const blank = CRITERIA.map((c) => ({ ...c, weight: null }));
const weighted = CRITERIA.map((c) => ({ ...c, weight: 10 }));
const all = [
  src("us_ecommerce", "US shipping"),
  src("size_fit", "About $4M revenue, 12 staff"),
  src("contact", "Jane | Founder"),
  src("growth_signal", "Hiring bookkeeper"),
  src("pain_signal", "Multi-channel"),
];

test("shipped config has no weights set yet", () => {
  assert.ok(CRITERIA.every((c) => c.weight === null));
});

test("blank weights: criteria evaluated, no points, no total", () => {
  const r = scoreCompany(all, blank);
  assert.equal(r.weightsComplete, false);
  assert.equal(r.total, null);
  assert.ok(r.criteria.every((c) => c.met && c.points === null));
});

test("partial weights: still no total", () => {
  const partial = weighted.map((c, i) => (i === 0 ? { ...c, weight: null } : c));
  assert.equal(scoreCompany(all, partial).total, null);
});

test("full weights: total sums points of met criteria", () => {
  const r = scoreCompany([src("us_ecommerce", "US shipping")], weighted);
  assert.equal(r.total, 10);
  assert.equal(r.maxTotal, 50);
});

test("unmet criterion says unknown and carries no sources", () => {
  const r = scoreCompany([], weighted);
  assert.ok(r.criteria.every((c) => !c.met && c.sources.length === 0));
  assert.match(r.criteria[0].reason, /unknown/);
  assert.equal(r.total, 0);
});

test("every met criterion is traceable to at least one source", () => {
  const r = scoreCompany(all, blank);
  assert.ok(r.criteria.filter((c) => c.met).every((c) => c.sources.length > 0));
});

test("disqualifiers are surfaced and never count as criterion evidence", () => {
  const r = scoreCompany([src("disqualifier", "Non-US")], weighted);
  assert.equal(r.disqualifiers.length, 1);
  assert.ok(r.criteria.every((c) => !c.met));
});

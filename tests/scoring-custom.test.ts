import { test } from "node:test";
import assert from "node:assert/strict";
import { getScoringConfig, parseScoringCriteria } from "../lib/scoring/custom";
import { CRITERIA } from "../lib/scoring/config";

const valid = JSON.stringify([
  { key: "market", label: "Market fit", measures: "US ecommerce evidence", claimType: "us_ecommerce", weight: 40 },
  { key: "contact", label: "Decision maker", measures: "Verified decision maker", claimType: "contact", weight: 20 },
  { key: "growth", label: "Growth", measures: "Evidence of growth", claimType: "growth_signal", weight: 20 },
  { key: "pain", label: "Pain", measures: "Evidence of finance operations pain", claimType: "pain_signal", weight: 20 },
]);

test("custom scoring criteria accept valid weights totaling 100", () => {
  const criteria = parseScoringCriteria(valid);
  assert.equal(criteria.length, 4);
  assert.equal(criteria.reduce((sum, item) => sum + (item.weight ?? 0), 0), 100);
});

test("custom scoring rejects weights that do not total 100", () => {
  assert.throws(() => parseScoringCriteria(valid.replace('"weight":40', '"weight":39')), /total 100/);
});

test("custom scoring rejects duplicate keys and unsupported claim types", () => {
  assert.throws(() => parseScoringCriteria(valid.replace('"key":"contact"', '"key":"market"')), /Duplicate/);
  assert.throws(() => parseScoringCriteria(valid.replace('"claimType":"contact"', '"claimType":"disqualifier"')), /unsupported/);
});

test("invalid environment config safely falls back to approved default rubric", () => {
  const result = getScoringConfig({ LEDGERWISE_SCORING_CRITERIA_JSON: "{}" });
  assert.equal(result.source, "default");
  assert.equal(result.criteria, CRITERIA);
  assert.match(result.warning ?? "", /ignored/);
});

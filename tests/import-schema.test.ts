import { test } from "node:test";
import assert from "node:assert/strict";
import { CLAIM_TYPES, validateRow } from "../lib/import-schema";

const base = {
  company_name: "ZZ TEST",
  website: "zz-test.example",
  claim_type: "category",
  claim: "Home goods",
  source_url: "https://example.com/about",
  source_title: "About page",
  retrieved_at: "2026-11-12",
  evidence: "Page describes a home goods brand",
};
const row = (o: Record<string, string> = {}) => ({ ...base, ...o });

test("claim types are exactly the closed set of seven", () => {
  assert.deepEqual(
    [...CLAIM_TYPES],
    ["us_ecommerce", "category", "size_fit", "growth_signal", "pain_signal", "disqualifier", "contact"]
  );
});

for (const t of CLAIM_TYPES) {
  test(`accepts ${t}`, () => {
    const claim = t === "contact" ? "Jane Doe | Founder" : "Some claim";
    assert.equal(validateRow(row({ claim_type: t, claim })).ok, true);
  });
}

for (const bad of ["size", "other", "pain_sigal", ""]) {
  test(`rejects claim_type "${bad}"`, () => {
    assert.equal(validateRow(row({ claim_type: bad })).ok, false);
  });
}

test("disqualifier rows are accepted (negative test set is kept)", () => {
  const r = validateRow(row({ claim_type: "disqualifier", claim: "Marketplace-only, no own site" }));
  assert.equal(r.ok, true);
});

test("disqualifier rows still need a source", () => {
  const r = validateRow(row({ claim_type: "disqualifier", source_url: "" }));
  assert.equal(r.ok, false);
});

test("contact must be Name | Role", () => {
  assert.equal(validateRow(row({ claim_type: "contact", claim: "Jane Doe" })).ok, false);
});

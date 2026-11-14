import test from "node:test";
import assert from "node:assert/strict";
import { verifyClaims, type ProposedClaim, type ResearchPage } from "../lib/research/verify";

const page: ResearchPage = {
  url: "https://example.com/about",
  title: "About Example",
  text: "Example makes home goods for customers across the United States. Jane Doe is the founder of Example. Contact Jane at jane@example.com for business inquiries.",
};

function proposal(overrides: Partial<ProposedClaim> = {}): ProposedClaim {
  return {
    claim_type: "category",
    claim: "Sells home goods",
    source_url: "https://example.com/about",
    evidence: "Example makes home goods for customers across the United States.",
    ...overrides,
  };
}

test("accepts a claim when its evidence appears on the fetched page", () => {
  const result = verifyClaims([proposal()], [page]);

  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.accepted[0].source_title, "About Example");
});

test("matches evidence despite case and whitespace differences", () => {
  const result = verifyClaims(
    [proposal({ evidence: "EXAMPLE makes   home goods for customers across the United States." })],
    [page],
  );

  assert.equal(result.accepted.length, 1);
});

test("rejects evidence that does not appear on the page", () => {
  const result = verifyClaims(
    [proposal({ evidence: "Example is the fastest growing home goods brand in America." })],
    [page],
  );

  assert.equal(result.accepted.length, 0);
  assert.match(result.rejected[0].reason, /does not appear/);
});

test("rejects unsupported claim types", () => {
  const result = verifyClaims(
    [proposal({ claim_type: "size" })],
    [page],
  );

  assert.equal(result.accepted.length, 0);
  assert.match(result.rejected[0].reason, /Unsupported/);
});

test("rejects a source URL that was not fetched", () => {
  const result = verifyClaims(
    [proposal({ source_url: "https://other.example/about" })],
    [page],
  );

  assert.equal(result.accepted.length, 0);
  assert.match(result.rejected[0].reason, /not among the fetched pages/);
});

test("rejects evidence outside the permitted length", () => {
  const result = verifyClaims(
    [proposal({ evidence: "Too short." })],
    [page],
  );

  assert.equal(result.accepted.length, 0);
  assert.match(result.rejected[0].reason, /between 20 and 300/);
});

test("accepts a contact only when name and role appear in the evidence", () => {
  const result = verifyClaims(
    [
      proposal({
        claim_type: "contact",
        claim: "Jane Doe | Founder | jane@example.com",
        evidence: "Jane Doe is the founder of Example. Contact Jane at jane@example.com for business inquiries.",
      }),
    ],
    [page],
  );

  assert.equal(result.accepted.length, 1);
});

test("rejects a contact whose name or role is absent from the evidence", () => {
  const result = verifyClaims(
    [
      proposal({
        claim_type: "contact",
        claim: "Jane Doe | Chief Financial Officer",
        evidence: "Jane Doe is the founder of Example. Contact Jane at jane@example.com for business inquiries.",
      }),
    ],
    [page],
  );

  assert.equal(result.accepted.length, 0);
  assert.match(result.rejected[0].reason, /name and role/);
});

test("rejects a contact email that is not on the page", () => {
  const result = verifyClaims(
    [
      proposal({
        claim_type: "contact",
        claim: "Jane Doe | Founder | jane@fake-example.com",
        evidence: "Jane Doe is the founder of Example. Contact Jane at jane@example.com for business inquiries.",
      }),
    ],
    [page],
  );

  assert.equal(result.accepted.length, 0);
  assert.match(result.rejected[0].reason, /email does not appear/);
});

test("rejects duplicate claims", () => {
  const result = verifyClaims([proposal(), proposal()], [page]);

  assert.equal(result.accepted.length, 1);
  assert.match(result.rejected[0].reason, /Duplicate/);
});

test("accepts no more than three claims of the same type", () => {
  const proposals = [
    proposal({ claim: "Claim one" }),
    proposal({ claim: "Claim two" }),
    proposal({ claim: "Claim three" }),
    proposal({ claim: "Claim four" }),
  ];

  const result = verifyClaims(proposals, [page]);

  assert.equal(result.accepted.length, 3);
  assert.match(result.rejected[0].reason, /Maximum of three/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canReject,
  canReset,
  canVerify,
  isStructurallyValidSource,
  isUsableVerifiedContact,
  isUsableVerifiedSource,
  newImportFields,
  rejectFields,
  resetFields,
  sourceStatusLabel,
  verifyFields,
  type SourceLike,
} from "../lib/sources/verification";

const now = "2026-11-14T12:00:00.000Z";

const source = (overrides: Partial<SourceLike> = {}): SourceLike => ({
  claim: "Hiring a staff accountant",
  claim_type: "growth_signal",
  source_url: "https://example.com/careers",
  evidence: "We are hiring a staff accountant for our growing team.",
  verification_status: "verified",
  reviewed_by: "user-1",
  reviewed_at: now,
  ...overrides,
});

test("newly imported sources are pending review and are not human-verified", () => {
  const fields = newImportFields("user-1");
  assert.equal(fields.verification_status, "pending_review");
  assert.equal(fields.imported_by, "user-1");
  assert.equal(fields.reviewed_by, null);
  assert.equal(fields.reviewed_at, null);
  assert.equal(fields.verified_by, null);
});

test("verify, reject, and reset patches set the correct review metadata", () => {
  const verified = verifyFields("user-2", now);
  assert.equal(verified.verification_status, "verified");
  assert.equal(verified.reviewed_by, "user-2");
  assert.equal(verified.reviewed_at, now);
  assert.equal(verified.verification_note, null);
  assert.equal("imported_by" in verified, false);

  const rejected = rejectFields("user-3", now, "  Evidence does not support the claim  ");
  assert.equal(rejected.verification_status, "rejected");
  assert.equal(rejected.reviewed_by, "user-3");
  assert.equal(rejected.verification_note, "Evidence does not support the claim");

  const reset = resetFields();
  assert.equal(reset.verification_status, "pending_review");
  assert.equal(reset.reviewed_by, null);
  assert.equal(reset.reviewed_at, null);
  assert.equal(reset.verification_note, null);
});

test("rejection requires a non-empty note", () => {
  assert.throws(() => rejectFields("user-1", now, "   "), /rejection note/i);
});

test("status transition guards", () => {
  assert.equal(canVerify("pending_review"), true);
  assert.equal(canVerify("verified"), true);
  assert.equal(canVerify("rejected"), true);
  assert.equal(canVerify("other"), false);
  assert.equal(canReject("pending_review"), true);
  assert.equal(canReset("verified"), true);
  assert.equal(canReset("rejected"), true);
  assert.equal(canReset("pending_review"), false);
});

test("only verified, reviewed, structurally valid sources are email-usable", () => {
  assert.equal(isUsableVerifiedSource(source()), true);
  assert.equal(isUsableVerifiedSource(source({ verification_status: "pending_review" })), false);
  assert.equal(isUsableVerifiedSource(source({ verification_status: "rejected" })), false);
  assert.equal(isUsableVerifiedSource(source({ reviewed_by: null })), false);
  assert.equal(isUsableVerifiedSource(source({ reviewed_at: null })), false);
  assert.equal(isUsableVerifiedSource(source({ claim_type: "disqualifier" })), false);
  assert.equal(isUsableVerifiedSource(source({ claim_type: "contact" })), false);
  assert.equal(isUsableVerifiedSource(source({ source_url: "UNVERIFIED" })), false);
  assert.equal(isUsableVerifiedSource(source({ source_url: "not a url" })), false);
  assert.equal(isUsableVerifiedSource(source({ evidence: "short" })), false);
  assert.equal(isUsableVerifiedSource(source({ claim: "   " })), false);
});

test("structural validation does not imply human verification", () => {
  assert.equal(
    isStructurallyValidSource(source({ verification_status: "pending_review" })),
    true
  );
  assert.equal(
    isUsableVerifiedSource(source({ verification_status: "pending_review" })),
    false
  );
});

test("a recipient email needs a verified contact source containing it", () => {
  const contact = source({
    claim: "Jane Doe | COO | jane@example.com",
    claim_type: "contact",
    evidence: "Jane Doe, COO. Contact: jane@example.com.",
    source_url: "https://example.com/team",
  });
  assert.equal(isUsableVerifiedContact(contact, "jane@example.com"), true);
  assert.equal(isUsableVerifiedContact(contact, " JANE@EXAMPLE.COM "), true);
  assert.equal(isUsableVerifiedContact(contact, "other@example.com"), false);
  assert.equal(
    isUsableVerifiedContact(
      source({
        claim: "Jane Doe | COO | mjane@example.com",
        claim_type: "contact",
        evidence: "Jane Doe, COO. Contact: mjane@example.com.",
        source_url: "https://example.com/team",
      }),
      "jane@example.com"
    ),
    false
  );
  assert.equal(
    isUsableVerifiedContact(
      source({
        claim: "Jane Doe | COO | jane@example.com.br",
        claim_type: "contact",
        evidence: "Jane Doe, COO. Contact: jane@example.com.br.",
        source_url: "https://example.com/team",
      }),
      "jane@example.com"
    ),
    false
  );
  assert.equal(
    isUsableVerifiedContact(
      { ...contact, verification_status: "pending_review" },
      "jane@example.com"
    ),
    false
  );
  assert.equal(
    isUsableVerifiedContact(
      { ...contact, reviewed_by: null },
      "jane@example.com"
    ),
    false
  );
  assert.equal(
    isUsableVerifiedContact(
      source({ claim: "Sells online", claim_type: "category" }),
      "jane@example.com"
    ),
    false
  );
});

test("status labels are explicit", () => {
  assert.equal(sourceStatusLabel("pending_review"), "Pending review");
  assert.equal(sourceStatusLabel("verified"), "Verified");
  assert.equal(sourceStatusLabel("rejected"), "Rejected");
});
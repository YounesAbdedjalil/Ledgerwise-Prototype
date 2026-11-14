import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEmailPrompt,
  buildEmailSystemPrompt,
  contactFirstName,
  fallbackEmailDraft,
  parseEmailDraft,
  selectEmailSources,
  validateEmailDraft,
  type CompanyForEmail,
  type DraftSource,
} from "../lib/email/draft";
import { scanOutboundMessage } from "../lib/email/guardrails";

const now = "2026-11-14T12:00:00.000Z";

const company: CompanyForEmail = {
  id: "company-1",
  name: "Acme Goods",
  category: "Home goods",
  us_ecommerce: "verified",
  growth_signal: "Hiring a staff accountant",
  contact_name: "Jane Doe",
  contact_role: "COO",
  contact_email: "jane@acme.test",
};

const source = (overrides: Partial<DraftSource> = {}): DraftSource => ({
  id: "source-1",
  claim: "Sells to US customers through its own store",
  claim_type: "us_ecommerce",
  source_url: "https://acme.test/about",
  source_title: "About Acme",
  retrieved_at: "2026-11-01",
  evidence: "We ship our products to customers across the United States.",
  verification_status: "verified",
  reviewed_by: "user-1",
  reviewed_at: now,
  ...overrides,
});

test("selectEmailSources keeps only human-verified, usable sources", () => {
  const selected = selectEmailSources([
    source({ id: "verified" }),
    source({ id: "pending", verification_status: "pending_review" }),
    source({ id: "rejected", verification_status: "rejected" }),
    source({ id: "no-reviewer", reviewed_by: null }),
    source({ id: "no-date", reviewed_at: null }),
    source({ id: "disqualifier", claim_type: "disqualifier" }),
    source({ id: "contact", claim_type: "contact" }),
    source({ id: "bad-url", source_url: "UNVERIFIED" }),
    source({ id: "short-evidence", evidence: "short" }),
  ]);
  assert.deepEqual(
    selected.map((item) => item.id),
    ["verified"]
  );
});

test("selectEmailSources caps the number of facts sent to the model", () => {
  const selected = selectEmailSources(
    Array.from({ length: 10 }, (_, i) =>
      source({ id: `source-${i}`, claim: `Claim ${i}` })
    )
  );
  assert.equal(selected.length, 6);
});

test("the fallback draft uses verified claims and passes guardrails", () => {
  const draft = fallbackEmailDraft(company, [
    source({ claim: "Sells to US customers through its own store" }),
    source({
      id: "source-2",
      claim: "Is hiring for a staff accountant",
      claim_type: "growth_signal",
    }),
  ]);
  assert.match(draft.subject, /Acme Goods/);
  assert.match(draft.body, /Sells to US customers/);
  assert.match(draft.body, /hiring for a staff accountant/i);
  assert.match(draft.body, /AI assistant/);
  assert.equal(validateEmailDraft(draft).ok, true);
});

test("pricing, guarantees, pressure, and human claims are blocked", () => {
  assert.ok(scanOutboundMessage("Our price is $500 per month").length > 0);
  assert.ok(scanOutboundMessage("We guarantee results").length > 0);
  assert.ok(scanOutboundMessage("Act now, limited time").length > 0);
  assert.ok(scanOutboundMessage("I am a real person, not a bot").length > 0);
  assert.equal(scanOutboundMessage("Would a short call be useful?").length, 0);
});

test("draft validation rejects placeholders and unsafe content", () => {
  assert.equal(
    validateEmailDraft({ subject: "", body: "Hello" }).ok,
    false
  );
  assert.equal(
    validateEmailDraft({ subject: "Hi", body: "Hello [insert name]" }).ok,
    false
  );
  assert.equal(
    validateEmailDraft({ subject: "Hi", body: "Our pricing starts at $99." }).ok,
    false
  );
});

test("parseEmailDraft accepts JSON and fenced JSON", () => {
  assert.deepEqual(
    parseEmailDraft('{"subject":"Hi","body":"Hello there"}'),
    { subject: "Hi", body: "Hello there" }
  );
  assert.deepEqual(
    parseEmailDraft('```json\n{"subject":"Hi","body":"Hello there"}\n```'),
    { subject: "Hi", body: "Hello there" }
  );
  assert.throws(() => parseEmailDraft("not json"), /JSON/);
});

test("the prompt carries only supplied facts and the revision note", () => {
  const prompt = buildEmailPrompt(company, [source()], {
    revisionNote: "Make it shorter",
    previous: { subject: "Old", body: "Old body" },
  });
  const parsed = JSON.parse(prompt);
  assert.equal(parsed.company.name, "Acme Goods");
  assert.equal(parsed.verified_facts.length, 1);
  assert.equal(parsed.revision_note, "Make it shorter");
  assert.equal(parsed.previous_draft.subject, "Old");
  assert.match(buildEmailSystemPrompt(), /Never mention price/);
  assert.match(buildEmailSystemPrompt(), /AI assistant/);
});

test("contact first name handles unknown contacts", () => {
  assert.equal(contactFirstName("Jane Doe"), "Jane");
  assert.equal(contactFirstName("unknown"), "there");
  assert.equal(contactFirstName(""), "there");
});
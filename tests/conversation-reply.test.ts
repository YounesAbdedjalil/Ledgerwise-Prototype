import { test } from "node:test";
import assert from "node:assert/strict";
import {
  botDisclosureReply,
  buildReplyPrompt,
  buildReplySystemPrompt,
  fallbackReply,
  parseReply,
  validateReply,
} from "../lib/conversations/reply";
import { classifyInboundMessage } from "../lib/conversations/classify";
import type { DraftSource } from "../lib/email/draft";

const source: DraftSource = {
  id: "source-1",
  claim: "Sells to US customers through its own store",
  claim_type: "us_ecommerce",
  source_url: "https://acme.test/about",
  source_title: "About Acme",
  retrieved_at: "2026-11-01",
  evidence: "We ship our products to customers across the United States.",
  verification_status: "verified",
  reviewed_by: "user-1",
  reviewed_at: "2026-11-01T12:00:00.000Z",
};

test("bot disclosure is explicit and safe", () => {
  const body = botDisclosureReply();
  assert.match(body, /AI assistant/);
  assert.equal(validateReply(body).ok, true);
});

test("general fallback is safe and contains no invented facts", () => {
  const classification = classifyInboundMessage("Tell me more.");
  const body = fallbackReply(classification);
  assert.match(body, /Ledgerwise team/);
  assert.equal(validateReply(body).ok, true);
});

test("reply validation blocks pricing and human claims", () => {
  assert.equal(validateReply("Our price is $500 per month.").ok, false);
  assert.equal(validateReply("I'm a real person, not a bot.").ok, false);
  assert.equal(validateReply("Hello [insert name]").ok, false);
  assert.equal(validateReply("Thanks — a teammate will follow up.").ok, true);
});

test("reply prompt includes only recent thread messages and verified facts", () => {
  const classification = classifyInboundMessage("Tell me more.");
  const prompt = buildReplyPrompt(
    classification,
    [
      { sender: "prospect", body: "Tell me more.", created_at: "2026-11-14T12:00:00Z" },
      { sender: "ai", body: "Happy to.", created_at: "2026-11-14T12:01:00Z" },
    ],
    [source]
  );
  const parsed = JSON.parse(prompt);
  assert.equal(parsed.classification.intent, "general");
  assert.equal(parsed.recent_thread.length, 2);
  assert.equal(parsed.verified_facts.length, 1);
  assert.match(buildReplySystemPrompt(), /Never mention price/);
  assert.match(buildReplySystemPrompt(), /AI assistant/);
});

test("parseReply accepts JSON and rejects empty output", () => {
  assert.deepEqual(parseReply('{"body":"Thanks"}'), { body: "Thanks" });
  assert.throws(() => parseReply('{"body":""}'), /reply body/);
});
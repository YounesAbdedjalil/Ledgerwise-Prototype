import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyInboundMessage } from "../lib/conversations/classify";

test("opt-out requests suppress and stop all replies", () => {
  for (const text of [
    "Please stop emailing me",
    "Unsubscribe",
    "Not interested",
    "Remove me from your list",
    "Do not contact me again",
  ]) {
    const result = classifyInboundMessage(text);
    assert.equal(result.intent, "opt_out", text);
    assert.equal(result.suppress, true, text);
    assert.equal(result.autoReplyAllowed, false, text);
  }
});

test("opt-out wins over a pricing question in the same message", () => {
  const result = classifyInboundMessage("What is the price? Also stop emailing me.");
  assert.equal(result.intent, "opt_out");
  assert.equal(result.suppress, true);
});

test("bot questions require honest disclosure and allow a safe reply", () => {
  const result = classifyInboundMessage("Are you a bot?");
  assert.equal(result.intent, "bot_question");
  assert.equal(result.needsHuman, false);
  assert.equal(result.autoReplyAllowed, true);
  assert.ok(result.flags.includes("bot_disclosure_required"));
});

test("pricing, legal, sensitive, and human requests escalate", () => {
  for (const [text, intent] of [
    ["How much does it cost?", "pricing"],
    ["Please send this to your legal team", "legal"],
    ["This is urgent and confidential", "sensitive"],
    ["Can I speak to a real person?", "human_request"],
  ] as const) {
    const result = classifyInboundMessage(text);
    assert.equal(result.intent, intent, text);
    assert.equal(result.needsHuman, true, text);
    assert.equal(result.autoReplyAllowed, false, text);
  }
});

test("booking intent sets the booking flag and never holds a slot automatically", () => {
  const result = classifyInboundMessage("Can we schedule a call next week?");
  assert.equal(result.intent, "booking_request");
  assert.equal(result.bookingRequest, true);
  assert.equal(result.needsHuman, true);
  assert.equal(result.autoReplyAllowed, false);
});

test("general replies are allowed to be drafted but still reviewed by a human", () => {
  const result = classifyInboundMessage("Thanks, tell me a bit more.");
  assert.equal(result.intent, "general");
  assert.equal(result.needsHuman, false);
  assert.equal(result.autoReplyAllowed, true);
});
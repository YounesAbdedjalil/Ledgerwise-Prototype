import { test } from "node:test";
import assert from "node:assert/strict";
import { isLiveEmailConfigured, sendWithBrevo } from "../lib/email/brevo";

const configured = {
  BREVO_API_KEY: "xkeysib_test_key",
  EMAIL_FROM: "hello@example.com",
  EMAIL_FROM_NAME: "Ledgerwise",
  EMAIL_LIVE_SEND_ENABLED: "1",
};

test("live sending requires explicit enablement and sender credentials", () => {
  assert.equal(isLiveEmailConfigured(configured), true);
  assert.equal(isLiveEmailConfigured({ ...configured, EMAIL_LIVE_SEND_ENABLED: "0" }), false);
  assert.equal(isLiveEmailConfigured({ ...configured, BREVO_API_KEY: "" }), false);
  assert.equal(isLiveEmailConfigured({ ...configured, EMAIL_FROM: "" }), false);
});

test("provider refuses to send while live sending is disabled", async () => {
  let called = false;
  const result = await sendWithBrevo(
    { to: "person@example.com", subject: "Hello", text: "Hi", idempotencyKey: "draft-1" },
    { ...configured, EMAIL_LIVE_SEND_ENABLED: "0" },
    async () => {
      called = true;
      return new Response(JSON.stringify({ messageId: "should-not-happen" }), { status: 201 });
    },
  );
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

test("Brevo request carries sender, content and stable draft reference", async () => {
  let capturedUrl = "";
  let captured: RequestInit | undefined;
  const result = await sendWithBrevo(
    { to: "person@example.com", subject: "Hello", text: "Hi", idempotencyKey: "ledgerwise-draft-123" },
    configured,
    async (url, init) => {
      capturedUrl = String(url);
      captured = init;
      return new Response(JSON.stringify({ messageId: "<brevo-123>" }), { status: 201 });
    },
  );
  assert.deepEqual(result, { ok: true, id: "<brevo-123>" });
  assert.equal(capturedUrl, "https://api.brevo.com/v3/smtp/email");
  assert.equal(captured?.method, "POST");
  assert.equal((captured?.headers as Record<string, string>)?.["api-key"], configured.BREVO_API_KEY);
  assert.deepEqual(JSON.parse(String(captured?.body)), {
    sender: { name: "Ledgerwise", email: "hello@example.com" },
    to: [{ email: "person@example.com" }],
    subject: "Hello",
    textContent: "Hi",
    headers: { "X-Mailin-custom": "ledgerwise_draft:ledgerwise-draft-123" },
  });
});

test("formatted sender address is split into Brevo name and email", async () => {
  let body = "";
  const result = await sendWithBrevo(
    { to: "person@example.com", subject: "Hello", text: "Hi", idempotencyKey: "draft-2" },
    { ...configured, EMAIL_FROM: "Ledgerwise Team <hello@example.com>" },
    async (_url, init) => {
      body = String(init?.body);
      return new Response(JSON.stringify({ messageId: "<brevo-456>" }), { status: 201 });
    },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(body).sender, { name: "Ledgerwise Team", email: "hello@example.com" });
});

test("provider errors are returned without pretending an email was sent", async () => {
  const result = await sendWithBrevo(
    { to: "person@example.com", subject: "Hello", text: "Hi", idempotencyKey: "draft-3" },
    configured,
    async () => new Response(JSON.stringify({ message: "sender not verified" }), { status: 400 }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /sender not verified/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { isLiveEmailConfigured, sendWithResend } from "../lib/email/resend";

const configured = {
  RESEND_API_KEY: "re_test_key",
  EMAIL_FROM: "Ledgerwise <hello@example.com>",
  EMAIL_LIVE_SEND_ENABLED: "1",
};

test("live sending requires explicit enablement and sender credentials", () => {
  assert.equal(isLiveEmailConfigured(configured), true);
  assert.equal(isLiveEmailConfigured({ ...configured, EMAIL_LIVE_SEND_ENABLED: "0" }), false);
  assert.equal(isLiveEmailConfigured({ ...configured, RESEND_API_KEY: "" }), false);
  assert.equal(isLiveEmailConfigured({ ...configured, EMAIL_FROM: "" }), false);
});

test("provider refuses to send while live sending is disabled", async () => {
  let called = false;
  const result = await sendWithResend(
    { to: "person@example.com", subject: "Hello", text: "Hi", idempotencyKey: "draft-1" },
    { ...configured, EMAIL_LIVE_SEND_ENABLED: "0" },
    async () => {
      called = true;
      return new Response(JSON.stringify({ id: "should-not-happen" }), { status: 200 });
    },
  );
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

test("Resend request includes stable idempotency key and returns provider ID", async () => {
  let captured: RequestInit | undefined;
  const result = await sendWithResend(
    { to: "person@example.com", subject: "Hello", text: "Hi", idempotencyKey: "ledgerwise-draft-123" },
    configured,
    async (_url, init) => {
      captured = init;
      return new Response(JSON.stringify({ id: "re_123" }), { status: 200 });
    },
  );
  assert.deepEqual(result, { ok: true, id: "re_123" });
  assert.equal((captured?.headers as Record<string, string>)?.["Idempotency-Key"], "ledgerwise-draft-123");
  assert.equal(captured?.method, "POST");
});

test("provider error is returned without pretending an email was sent", async () => {
  const result = await sendWithResend(
    { to: "person@example.com", subject: "Hello", text: "Hi", idempotencyKey: "draft-2" },
    configured,
    async () => new Response(JSON.stringify({ message: "domain not verified" }), { status: 403 }),
  );
  assert.equal(result.ok, false);
  if ("error" in result) assert.match(result.error, /domain not verified/);
});

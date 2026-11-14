import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidEmail, normalizeEmail, trimText } from "../lib/validation";

test("email normalization trims and lowercases", () => {
  assert.equal(normalizeEmail("  Jane.Doe@Example.COM  "), "jane.doe@example.com");
});

test("email validation accepts normal addresses and rejects malformed ones", () => {
  assert.equal(isValidEmail("jane@example.com"), true);
  assert.equal(isValidEmail("JANE@EXAMPLE.COM"), true);
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidEmail("a@b"), false);
  assert.equal(isValidEmail(""), false);
});

test("trimText enforces required text and maximum length", () => {
  assert.equal(trimText("  hello  ", 10), "hello");
  assert.equal(trimText("   ", 10), null);
  assert.equal(trimText("too long", 3), null);
  assert.equal(trimText(42, 10), null);
});
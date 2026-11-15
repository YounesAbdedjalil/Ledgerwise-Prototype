import { test } from "node:test";
import assert from "node:assert/strict";
import { getSourceFreshness } from "../lib/research/freshness";

test("source freshness uses explicit 90 and 180 day bands", () => {
  const now = new Date("2026-11-15T12:00:00.000Z");
  assert.equal(getSourceFreshness("2026-11-15", now), "fresh");
  assert.equal(getSourceFreshness("2026-08-17", now), "fresh");
  assert.equal(getSourceFreshness("2026-08-16", now), "aging");
  assert.equal(getSourceFreshness("2026-05-19", now), "aging");
  assert.equal(getSourceFreshness("2026-05-18", now), "stale");
});

test("invalid or future retrieval dates are unknown", () => {
  const now = new Date("2026-11-15T12:00:00.000Z");
  assert.equal(getSourceFreshness("not-a-date", now), "unknown");
  assert.equal(getSourceFreshness("2026-11-16", now), "unknown");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGoogleEvent,
  deleteGoogleEvent,
  getGoogleAccessToken,
  googleCalendarStatus,
  syncBookingToGoogle,
  updateGoogleEvent,
} from "../lib/calendar/google";

const configuredEnv = {
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_REFRESH_TOKEN: "refresh-token",
  GOOGLE_CALENDAR_ID: "calendar@example.com",
};

const eventInput = {
  summary: "Ledgerwise call: Jane Doe",
  description: "Prospect: Jane Doe",
  startTime: "2026-11-15T14:00:00.000Z",
  endTime: "2026-11-15T14:30:00.000Z",
  timezone: "America/New_York",
};

test("Google status never claims operational without explicit verification", () => {
  const missing = googleCalendarStatus({});
  assert.equal(missing.configured, false);
  assert.equal(missing.operational, false);
  assert.match(missing.reason, /internal calendar/i);

  const unverified = googleCalendarStatus(configuredEnv);
  assert.equal(unverified.configured, true);
  assert.equal(unverified.verified, false);
  assert.equal(unverified.operational, false);

  const disabled = googleCalendarStatus({
    ...configuredEnv,
    GOOGLE_CALENDAR_VERIFIED: "1",
  });
  assert.equal(disabled.operational, false);
  assert.match(disabled.reason, /sync is disabled/);

  const enabled = googleCalendarStatus({
    ...configuredEnv,
    GOOGLE_CALENDAR_VERIFIED: "1",
    GOOGLE_CALENDAR_SYNC: "1",
  });
  assert.equal(enabled.operational, true);
});

test("sync is a no-op unless explicitly enabled", async () => {
  let calls = 0;
  const result = await syncBookingToGoogle(eventInput, {}, {
    fetch: async () => {
      calls++;
      return new Response("{}");
    },
  });
  assert.equal(result.status, "not_configured");
  assert.equal(calls, 0);
});

test("access token exchange sends a refresh-token grant", async () => {
  let body: BodyInit | null | undefined;
  const token = await getGoogleAccessToken(configuredEnv, async (_url, init) => {
    body = init?.body;
    return new Response(JSON.stringify({ access_token: "token-1" }), { status: 200 });
  });
  assert.equal(token, "token-1");
  assert.match(String(body), /grant_type=refresh_token/);
});

test("sync creates a Google event and returns its id", async () => {
  const requests: string[] = [];
  const result = await syncBookingToGoogle(
    eventInput,
    {
      ...configuredEnv,
      GOOGLE_CALENDAR_VERIFIED: "1",
      GOOGLE_CALENDAR_SYNC: "1",
    },
    {
      fetch: async (url, init) => {
        requests.push(url);
        if (url.includes("oauth2.googleapis.com")) {
          return new Response(JSON.stringify({ access_token: "token-1" }), {
            status: 200,
          });
        }
        const body = JSON.parse(String(init?.body));
        assert.equal(body.summary, eventInput.summary);
        assert.equal(body.start.timeZone, "America/New_York");
        return new Response(JSON.stringify({ id: "event-1" }), { status: 200 });
      },
    }
  );
  assert.deepEqual(result, { status: "synced", eventId: "event-1" });
  assert.equal(requests.length, 2);
  assert.match(requests[1], /calendars\/calendar%40example\.com\/events/);
});

test("Google HTTP failures are reported without claiming success", async () => {
  const result = await syncBookingToGoogle(
    eventInput,
    {
      ...configuredEnv,
      GOOGLE_CALENDAR_VERIFIED: "1",
      GOOGLE_CALENDAR_SYNC: "1",
    },
    {
      fetch: async (url) => {
        if (url.includes("oauth2.googleapis.com")) {
          return new Response(JSON.stringify({ access_token: "token-1" }), {
            status: 200,
          });
        }
        return new Response("nope", { status: 500 });
      },
    }
  );
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.match(result.error, /HTTP 500/);
  }
});

test("buildGoogleEvent uses the slot times and timezone", () => {
  const event = buildGoogleEvent(eventInput);
  assert.equal(event.start.dateTime, eventInput.startTime);
  assert.equal(event.end.timeZone, "America/New_York");
});

test("events can be updated with PATCH using the new slot details", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const result = await updateGoogleEvent(
    "event-1",
    { ...eventInput, startTime: "2026-11-16T15:00:00.000Z" },
    {
      ...configuredEnv,
      GOOGLE_CALENDAR_VERIFIED: "1",
      GOOGLE_CALENDAR_SYNC: "1",
    },
    {
      fetch: async (url, init) => {
        requests.push({ url, init });
        if (url.includes("oauth2.googleapis.com")) {
          return new Response(JSON.stringify({ access_token: "token-1" }), {
            status: 200,
          });
        }
        const body = JSON.parse(String(init?.body));
        assert.equal(body.start.dateTime, "2026-11-16T15:00:00.000Z");
        return new Response(JSON.stringify({ id: "event-1" }), { status: 200 });
      },
    }
  );
  assert.deepEqual(result, { status: "synced" });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].init?.method, "PATCH");
  assert.match(requests[1].url, /events\/event-1$/);
});

test("deletion treats an already-removed event as success", async () => {
  const result = await deleteGoogleEvent(
    "event-1",
    {
      ...configuredEnv,
      GOOGLE_CALENDAR_VERIFIED: "1",
      GOOGLE_CALENDAR_SYNC: "1",
    },
    {
      fetch: async (url, init) => {
        if (url.includes("oauth2.googleapis.com")) {
          return new Response(JSON.stringify({ access_token: "token-1" }), {
            status: 200,
          });
        }
        assert.equal(init?.method, "DELETE");
        return new Response(null, { status: 404 });
      },
    }
  );
  assert.deepEqual(result, { status: "synced" });
});

test("update and delete are no-ops unless sync is enabled", async () => {
  let calls = 0;
  const fetch = async () => {
    calls++;
    return new Response("{}");
  };
  assert.equal(
    (await updateGoogleEvent("event-1", eventInput, {}, { fetch })).status,
    "not_configured"
  );
  assert.equal(
    (await deleteGoogleEvent("event-1", {}, { fetch })).status,
    "not_configured"
  );
  assert.equal(calls, 0);
});

const required = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "GOOGLE_CALENDAR_ID",
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing environment variable: ${key}`);
    process.exit(1);
  }
}

async function main() {
  console.log("1. Requesting Google access token...");

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!tokenResponse.ok) {
    throw new Error(`OAuth failed: HTTP ${tokenResponse.status}`);
  }

  const { access_token } = await tokenResponse.json();
  if (!access_token) throw new Error("No access token returned.");

  console.log("OAuth successful.");

  const base =
    `https://www.googleapis.com/calendar/v3/calendars/` +
    `${encodeURIComponent(process.env.GOOGLE_CALENDAR_ID)}/events`;

  const headers = {
    Authorization: `Bearer ${access_token}`,
    "Content-Type": "application/json",
  };

  let eventId;

  try {
    console.log("2. Creating temporary calendar event...");

    const create = await fetch(base, {
      method: "POST",
      headers,
      body: JSON.stringify({
        summary: "Ledgerwise integration verification",
        description: "Temporary test event. Safe to delete.",
        start: {
          dateTime: "2026-11-16T10:00:00-05:00",
          timeZone: "America/New_York",
        },
        end: {
          dateTime: "2026-11-16T10:15:00-05:00",
          timeZone: "America/New_York",
        },
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!create.ok) throw new Error(`Create failed: HTTP ${create.status}`);

    const created = await create.json();
    eventId = created.id;
    if (!eventId) throw new Error("Google returned no event ID.");

    console.log("Event created.");

    console.log("3. Updating temporary event...");

    const update = await fetch(`${base}/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        summary: "Ledgerwise integration verification (updated)",
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!update.ok) throw new Error(`Update failed: HTTP ${update.status}`);

    console.log("Event updated.");

    console.log("4. Deleting temporary event...");

    const deletion = await fetch(`${base}/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
      headers,
      signal: AbortSignal.timeout(20000),
    });

    if (!deletion.ok && deletion.status !== 404 && deletion.status !== 410) {
      throw new Error(`Delete failed: HTTP ${deletion.status}`);
    }

    eventId = undefined;
    console.log("Event deleted.");
    console.log("\nSUCCESS: OAuth and Google Calendar create/update/delete verified.");
  } finally {
    if (eventId) {
      console.error(
        "WARNING: Test did not finish. A temporary event may remain. Event ID:",
        eventId
      );
    }
  }
}

main().catch((error) => {
  console.error("VERIFICATION FAILED:", error.message);
  process.exitCode = 1;
});

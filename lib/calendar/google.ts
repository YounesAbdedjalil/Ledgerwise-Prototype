type Env = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type GoogleCalendarStatus = {
  configured: boolean;
  verified: boolean;
  syncEnabled: boolean;
  operational: boolean;
  reason: string;
};

export type GoogleEventInput = {
  summary: string;
  description: string;
  startTime: string;
  endTime: string;
  timezone: string;
};

export type GoogleSyncResult =
  | { status: "not_configured"; error?: string }
  | { status: "synced"; eventId: string }
  | { status: "failed"; error: string };

export type GoogleMutationResult =
  | { status: "not_configured"; error?: string }
  | { status: "synced" }
  | { status: "failed"; error: string };

const REQUIRED = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "GOOGLE_CALENDAR_ID",
] as const;

export function googleCalendarStatus(env: Env = process.env): GoogleCalendarStatus {
  const missing = REQUIRED.filter((key) => !env[key]);
  const configured = missing.length === 0;
  const verified = env.GOOGLE_CALENDAR_VERIFIED === "1";
  const syncEnabled = env.GOOGLE_CALENDAR_SYNC === "1";
  const operational = configured && verified && syncEnabled;

  let reason: string;
  if (!configured) {
    reason = `Not configured (missing ${missing.join(", ")}). The internal calendar is the source of truth.`;
  } else if (!verified) {
    reason =
      "Credentials are present, but Google Calendar has not been verified end-to-end. The internal calendar is the source of truth.";
  } else if (!syncEnabled) {
    reason =
      "Google Calendar is verified but sync is disabled. Set GOOGLE_CALENDAR_SYNC=1 to enable it.";
  } else {
    reason = "Google Calendar sync is explicitly enabled and reported as verified.";
  }

  return { configured, verified, syncEnabled, operational, reason };
}

export function buildGoogleEvent(input: GoogleEventInput) {
  return {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.startTime, timeZone: input.timezone },
    end: { dateTime: input.endTime, timeZone: input.timezone },
  };
}

export async function getGoogleAccessToken(
  env: Env = process.env,
  fetchImpl: FetchLike = fetch
): Promise<string> {
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID ?? "",
    client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
    refresh_token: env.GOOGLE_REFRESH_TOKEN ?? "",
    grant_type: "refresh_token",
  });
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Google token request failed with HTTP ${response.status}.`);
  }
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Google did not return an access token.");
  return data.access_token;
}

export async function syncBookingToGoogle(
  input: GoogleEventInput,
  env: Env = process.env,
  deps: { fetch?: FetchLike } = {}
): Promise<GoogleSyncResult> {
  const status = googleCalendarStatus(env);
  if (!status.operational) {
    return { status: "not_configured", error: status.reason };
  }

  const fetchImpl = deps.fetch ?? fetch;
  try {
    const token = await getGoogleAccessToken(env, fetchImpl);
    const calendarId = encodeURIComponent(env.GOOGLE_CALENDAR_ID!);
    const response = await fetchImpl(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildGoogleEvent(input)),
        signal: AbortSignal.timeout(20_000),
      }
    );
    if (!response.ok) {
      return {
        status: "failed",
        error: `Google event creation failed with HTTP ${response.status}.`,
      };
    }
    const data = (await response.json()) as { id?: string };
    if (!data.id) return { status: "failed", error: "Google returned no event ID." };
    return { status: "synced", eventId: data.id };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "Google Calendar sync failed.",
    };
  }
}

function googleEventsUrl(env: Env, eventId?: string): string {
  const calendarId = encodeURIComponent(env.GOOGLE_CALENDAR_ID ?? "");
  const base = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;
  return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
}

async function googleMutation(
  input: GoogleEventInput | null,
  eventId: string,
  method: "PATCH" | "DELETE",
  env: Env,
  deps: { fetch?: FetchLike }
): Promise<GoogleMutationResult> {
  const status = googleCalendarStatus(env);
  if (!status.operational) {
    return { status: "not_configured", error: status.reason };
  }

  const fetchImpl = deps.fetch ?? fetch;
  try {
    const token = await getGoogleAccessToken(env, fetchImpl);
    const response = await fetchImpl(googleEventsUrl(env, eventId), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(method === "PATCH" ? { "Content-Type": "application/json" } : {}),
      },
      body:
        method === "PATCH" && input
          ? JSON.stringify(buildGoogleEvent(input))
          : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    if (method === "DELETE" && (response.status === 404 || response.status === 410)) {
      return { status: "synced" };
    }
    if (!response.ok) {
      return {
        status: "failed",
        error: `Google event ${method === "PATCH" ? "update" : "deletion"} failed with HTTP ${response.status}.`,
      };
    }
    if (method === "PATCH") {
      const data = (await response.json()) as { id?: string };
      if (!data.id) return { status: "failed", error: "Google returned no event ID." };
    }
    return { status: "synced" };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "Google Calendar sync failed.",
    };
  }
}

export async function updateGoogleEvent(
  eventId: string,
  input: GoogleEventInput,
  env: Env = process.env,
  deps: { fetch?: FetchLike } = {}
): Promise<GoogleMutationResult> {
  return googleMutation(input, eventId, "PATCH", env, deps);
}

export async function deleteGoogleEvent(
  eventId: string,
  env: Env = process.env,
  deps: { fetch?: FetchLike } = {}
): Promise<GoogleMutationResult> {
  return googleMutation(null, eventId, "DELETE", env, deps);
}

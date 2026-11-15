export type ResendSendInput = {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  idempotencyKey: string;
};

export type ResendSendResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type ResendEnv = {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
  EMAIL_LIVE_SEND_ENABLED?: string;
};

export function isLiveEmailConfigured(env: ResendEnv = process.env as ResendEnv): boolean {
  return (
    env.EMAIL_LIVE_SEND_ENABLED === "1" &&
    Boolean(env.RESEND_API_KEY?.trim()) &&
    Boolean(env.EMAIL_FROM?.trim())
  );
}

export async function sendWithResend(
  input: ResendSendInput,
  env: ResendEnv = process.env as ResendEnv,
  fetcher: FetchLike = fetch,
): Promise<ResendSendResult> {
  if (!isLiveEmailConfigured(env)) {
    return {
      ok: false,
      error:
        "Live email is disabled. Configure RESEND_API_KEY and EMAIL_FROM, then explicitly set EMAIL_LIVE_SEND_ENABLED=1.",
    };
  }

  const response = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      ...(input.replyTo || env.EMAIL_REPLY_TO
        ? { reply_to: input.replyTo ?? env.EMAIL_REPLY_TO }
        : {}),
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const payload = (await response.json().catch(() => null)) as
    | { id?: unknown; message?: unknown; name?: unknown }
    | null;

  if (!response.ok || typeof payload?.id !== "string") {
    const detail =
      typeof payload?.message === "string"
        ? payload.message
        : typeof payload?.name === "string"
          ? payload.name
          : `HTTP ${response.status}`;
    return { ok: false, error: `Resend could not send the email: ${detail}` };
  }

  return { ok: true, id: payload.id };
}

export type BrevoSendInput = {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  idempotencyKey: string;
};

export type BrevoSendResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type BrevoEnv = {
  BREVO_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  EMAIL_REPLY_TO?: string;
  EMAIL_LIVE_SEND_ENABLED?: string;
};

export function isLiveEmailConfigured(env: BrevoEnv = process.env as BrevoEnv): boolean {
  return (
    env.EMAIL_LIVE_SEND_ENABLED === "1" &&
    Boolean(env.BREVO_API_KEY?.trim()) &&
    Boolean(env.EMAIL_FROM?.trim())
  );
}

export async function sendWithBrevo(
  input: BrevoSendInput,
  env: BrevoEnv = process.env as BrevoEnv,
  fetcher: FetchLike = fetch,
): Promise<BrevoSendResult> {
  if (!isLiveEmailConfigured(env)) {
    return {
      ok: false,
      error:
        "Live email is disabled. Configure BREVO_API_KEY and EMAIL_FROM, then explicitly set EMAIL_LIVE_SEND_ENABLED=1.",
    };
  }

  let senderName = env.EMAIL_FROM_NAME?.trim() || "Ledgerwise";
  let senderEmail = env.EMAIL_FROM!.trim();
  const namedAddress = senderEmail.match(/^(.*?)\s*<([^<>]+)>$/);
  if (namedAddress) {
    senderName = namedAddress[1].trim().replace(/^\"|\"$/g, "") || senderName;
    senderEmail = namedAddress[2].trim();
  }

  const response = await fetcher("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": env.BREVO_API_KEY!,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: input.to }],
      subject: input.subject,
      textContent: input.text,
      ...(input.replyTo || env.EMAIL_REPLY_TO
        ? { replyTo: { email: input.replyTo ?? env.EMAIL_REPLY_TO } }
        : {}),
      headers: { "X-Mailin-custom": `ledgerwise_draft:${input.idempotencyKey}` },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const payload = (await response.json().catch(() => null)) as
    | { messageId?: unknown; message?: unknown; code?: unknown }
    | null;

  if (!response.ok || typeof payload?.messageId !== "string") {
    const detail =
      typeof payload?.message === "string"
        ? payload.message
        : typeof payload?.code === "string"
          ? payload.code
          : `HTTP ${response.status}`;
    return { ok: false, error: `Brevo could not send the email: ${detail}` };
  }

  return { ok: true, id: payload.messageId };
}

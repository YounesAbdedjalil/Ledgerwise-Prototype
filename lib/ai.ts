// Single entry point for all LLM calls. Server-side only (reads API keys).
// Tries a configured chain of models per task, with cooldowns for models
// that are rate-limited or broken.

export type Task = "extract" | "message";
export type Provider = "gemini" | "groq";
export type ModelRef = { provider: Provider; model: string };

export type AiRequest = {
  task: Task;
  system: string;
  prompt: string;
  json?: boolean;
  temperature?: number;
  maxTokens?: number; // output cap, default 1000
};

export type AiResponse = {
  text: string;
  provider: Provider;
  model: string;
  attempts: string[]; // models that failed or were skipped before this one answered
};

export class AiUnavailableError extends Error {
  constructor(public attempts: string[]) {
    super(`No AI model could answer: ${attempts.join(" | ")}`);
  }
}

class AiHttpError extends Error {
  constructor(public status: number, public retryAfterMs?: number) {
    super(`HTTP ${status}`);
  }
}
class AiOutputError extends Error {}

type Env = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type Deps = {
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const TIMEOUT_MS = 60_000;
const MIN_GAP_MS: Record<Provider, number> = { gemini: 4_500, groq: 2_200 };
const GROQ_TPM_BUDGET = 7_000; // limit is 8K/min, input + output
const GROQ_MAX_CALL_TOKENS = 6_000;
const RATE_LIMIT_COOLDOWNS_MS = [60_000, 600_000, 10_800_000]; // 1 min, 10 min, 3 h
const TRANSIENT_COOLDOWN_MS = 30_000;
const CONFIG_COOLDOWN_MS = 24 * 3_600_000;
const MAX_RETRY_AFTER_MS = 10_800_000;

const estimateTokens = (s: string) => Math.ceil(s.length / 3); // deliberately conservative

function parseRetryAfter(res: Response): number | undefined {
  const v = res.headers.get("retry-after");
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.min(n * 1000, MAX_RETRY_AFTER_MS);
}

function parseChain(raw: string): ModelRef[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((entry): ModelRef[] => {
      const i = entry.indexOf(":");
      if (i < 1) return [];
      const provider = entry.slice(0, i);
      const model = entry.slice(i + 1).trim();
      if ((provider !== "gemini" && provider !== "groq") || !model) return [];
      return [{ provider, model }];
    });
}

function chainFor(task: Task, env: Env): ModelRef[] {
  const raw = task === "extract" ? env.AI_EXTRACT_CHAIN : env.AI_MESSAGE_CHAIN;
  const groqDefault = env.GROQ_MODEL || "openai/gpt-oss-120b";
  let chain: ModelRef[];
  if (raw) {
    chain = parseChain(raw);
  } else if (task === "extract") {
    chain = [
      ...(env.GEMINI_MODEL ? [{ provider: "gemini" as const, model: env.GEMINI_MODEL }] : []),
      { provider: "groq" as const, model: groqDefault },
    ];
  } else {
    chain = [{ provider: "groq" as const, model: groqDefault }];
  }
  // Prospect messages never go to Gemini's free tier (it may train on them),
  // unless explicitly allowed. Use the override only with fake test data.
  if (task === "message" && env.AI_MESSAGES_ALLOW_GEMINI !== "1") {
    chain = chain.filter((r) => r.provider !== "gemini");
  }
  return chain;
}

async function callGemini(req: AiRequest, key: string, model: string, f: FetchLike) {
  const res = await f(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: [{ text: req.prompt }] }],
        generationConfig: {
          temperature: req.temperature ?? 0.2,
          maxOutputTokens: req.maxTokens ?? 1000,
          ...(req.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }
  );
  if (!res.ok) throw new AiHttpError(res.status, parseRetryAfter(res));
  const data = await res.json();
  const cand = data?.candidates?.[0];
  if (cand?.finishReason === "MAX_TOKENS") throw new AiOutputError("output truncated");
  const text = (cand?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? "")
    .join("");
  if (!text) throw new AiOutputError("returned no text");
  return text as string;
}

async function callGroq(
  req: AiRequest, key: string, model: string, effort: string | undefined, f: FetchLike
) {
  const system = req.json
    ? `${req.system}\n\nReply with a single JSON object and nothing else.`
    : req.system;
  const res = await f("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: req.temperature ?? 0.2,
      max_completion_tokens: req.maxTokens ?? 1000,
      ...(effort ? { reasoning_effort: effort } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: req.prompt },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new AiHttpError(res.status, parseRetryAfter(res));
  const data = await res.json();
  const choice = data?.choices?.[0];
  if (choice?.finish_reason === "length") throw new AiOutputError("output truncated");
  const text = choice?.message?.content;
  if (!text) throw new AiOutputError("returned no text");
  return text as string;
}

export function extractJson<T = unknown>(text: string): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned) as T; // throws on invalid JSON: callers must treat that as failure
}

function describe(e: unknown): string {
  if (e instanceof AiHttpError) {
    const hint = [401, 403, 404].includes(e.status) ? " (check the API key and model ID)" : "";
    return `${e.message}${hint}`;
  }
  return e instanceof Error ? e.message : "unknown error";
}

export function createAi(env: Env = process.env, deps: Deps = {}) {
  const f: FetchLike = deps.fetch ?? ((u, i) => fetch(u, i));
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const cooldownUntil = new Map<string, number>();
  const strikes = new Map<string, number>();
  const lastCall: Record<Provider, number> = { gemini: -Infinity, groq: -Infinity };
  const groqWindows = new Map<string, { t: number; tokens: number }[]>();
  const idOf = (r: ModelRef) => `${r.provider}:${r.model}`;

  async function throttle(ref: ModelRef, est: number) {
    for (;;) {
      const t = now();
      let wait = Math.max(0, lastCall[ref.provider] + MIN_GAP_MS[ref.provider] - t);
      if (ref.provider === "groq") {
        const w = groqWindows.get(idOf(ref)) ?? [];
        while (w.length && w[0].t <= t - 60_000) w.shift();
        groqWindows.set(idOf(ref), w);
        const used = w.reduce((s, e) => s + e.tokens, 0);
        if (used + est > GROQ_TPM_BUDGET && w.length) {
          wait = Math.max(wait, w[0].t + 60_000 - t);
        }
      }
      if (wait <= 0) return;
      await sleep(wait);
    }
  }

  function penalize(id: string, e: unknown) {
    const t = now();
    if (e instanceof AiOutputError) return; // the model isn't at fault
    if (e instanceof AiHttpError) {
      if (e.status === 429) {
        const n = (strikes.get(id) ?? 0) + 1;
        strikes.set(id, n);
        const ms =
          e.retryAfterMs ??
          RATE_LIMIT_COOLDOWNS_MS[Math.min(n - 1, RATE_LIMIT_COOLDOWNS_MS.length - 1)];
        cooldownUntil.set(id, t + ms);
      } else if ([401, 403, 404].includes(e.status)) {
        cooldownUntil.set(id, t + CONFIG_COOLDOWN_MS);
      } else if (e.status >= 500) {
        cooldownUntil.set(id, t + TRANSIENT_COOLDOWN_MS);
      }
      return; // other 4xx (such as 400) may be input-specific: no cooldown
    }
    cooldownUntil.set(id, t + TRANSIENT_COOLDOWN_MS); // network error or timeout
  }

  async function generate(req: AiRequest): Promise<AiResponse> {
    const attempts: string[] = [];
    const chain = chainFor(req.task, env);
    if (chain.length === 0) {
      throw new AiUnavailableError([`no models configured for task "${req.task}"`]);
    }

    for (const ref of chain) {
      const id = idOf(ref);
      const t0 = now();
      const until = cooldownUntil.get(id) ?? 0;
      if (t0 < until) {
        attempts.push(`${id}: cooling down for ${Math.ceil((until - t0) / 1000)}s`);
        continue;
      }

      const key = ref.provider === "gemini" ? env.GEMINI_API_KEY : env.GROQ_API_KEY;
      if (!key) {
        attempts.push(`${id}: no API key configured`);
        continue;
      }

      const est = estimateTokens(req.system + req.prompt) + (req.maxTokens ?? 1000);
      if (ref.provider === "groq" && est > GROQ_MAX_CALL_TOKENS) {
        attempts.push(`${id}: input too large for the tokens-per-minute cap (~${est} tokens)`);
        continue;
      }

      try {
        await throttle(ref, est);
        const text =
          ref.provider === "gemini"
            ? await callGemini(req, key, ref.model, f)
            : await callGroq(req, key, ref.model, env.GROQ_REASONING_EFFORT, f);
        strikes.delete(id);
        return { text, provider: ref.provider, model: ref.model, attempts };
      } catch (e) {
        attempts.push(`${id}: ${describe(e)}`);
        penalize(id, e);
      } finally {
        lastCall[ref.provider] = now();
        if (ref.provider === "groq") {
          const w = groqWindows.get(id) ?? [];
          w.push({ t: now(), tokens: est });
          groqWindows.set(id, w);
        }
      }
    }
    throw new AiUnavailableError(attempts);
  }

  // Which models are currently cooling down (useful for a status panel later).
  function status() {
    const t = now();
    return [...cooldownUntil]
      .filter(([, until]) => until > t)
      .map(([model, until]) => ({ model, availableAt: new Date(until).toISOString() }));
  }

  return { generate, status };
}

export const { generate, status: aiStatus } = createAi();

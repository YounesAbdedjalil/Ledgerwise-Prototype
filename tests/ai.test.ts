import { test } from "node:test";
import assert from "node:assert/strict";
import { createAi, extractJson, AiUnavailableError } from "../lib/ai";

const geminiOk = (text: string, finishReason = "STOP") =>
  new Response(
    JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text }] } }] }),
    { status: 200 }
  );
const groqOk = (text: string) =>
  new Response(
    JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: text } }] }),
    { status: 200 }
  );
const status = (n: number, headers?: Record<string, string>) =>
  new Response("{}", { status: n, headers });
const isGemini = (u: string) => u.includes("googleapis");
const hits = (u: string, model: string) => u.includes(`/models/${model}:`);

const keys = { GEMINI_API_KEY: "g", GROQ_API_KEY: "q" };
const extract = { task: "extract" as const, system: "s", prompt: "p" };
const message = { task: "message" as const, system: "s", prompt: "p" };

function setup(fetch: (u: string) => Promise<Response>) {
  let t = 1_000_000;
  const slept: number[] = [];
  return {
    slept,
    advance: (ms: number) => {
      t += ms;
    },
    deps: {
      fetch,
      now: () => t,
      sleep: async (ms: number) => {
        slept.push(ms);
        t += ms;
      },
    },
  };
}

test("uses the first model in the chain when it works", async () => {
  const { deps } = setup(async () => geminiOk("hi"));
  const { generate } = createAi({ ...keys, AI_EXTRACT_CHAIN: "gemini:a,groq:x" }, deps);
  const r = await generate(extract);
  assert.equal(r.provider, "gemini");
  assert.equal(r.model, "a");
  assert.equal(r.text, "hi");
});

test("falls through to the next provider on a 429", async () => {
  const { deps } = setup(async (u) => (isGemini(u) ? status(429) : groqOk("from groq")));
  const { generate } = createAi({ ...keys, AI_EXTRACT_CHAIN: "gemini:a,groq:x" }, deps);
  const r = await generate(extract);
  assert.equal(r.provider, "groq");
  assert.equal(r.attempts.length, 1);
});

test("a rate-limited model is skipped on the next call", async () => {
  let a = 0;
  const { deps } = setup(async (u) => {
    if (hits(u, "a")) {
      a++;
      return status(429);
    }
    return geminiOk("from b");
  });
  const { generate } = createAi({ ...keys, AI_EXTRACT_CHAIN: "gemini:a,gemini:b" }, deps);
  assert.equal((await generate(extract)).model, "b");
  assert.equal((await generate(extract)).model, "b");
  assert.equal(a, 1);
});

test("a model is retried after its cooldown expires", async () => {
  let a = 0;
  const { deps, advance } = setup(async (u) => {
    if (hits(u, "a")) {
      a++;
      return a === 1 ? status(429) : geminiOk("from a");
    }
    return geminiOk("from b");
  });
  const { generate } = createAi({ ...keys, AI_EXTRACT_CHAIN: "gemini:a,gemini:b" }, deps);
  assert.equal((await generate(extract)).model, "b");
  advance(61_000);
  assert.equal((await generate(extract)).model, "a");
});

test("a Retry-After header sets the cooldown", async () => {
  let a = 0;
  const { deps, advance } = setup(async (u) => {
    if (hits(u, "a")) {
      a++;
      return status(429, { "retry-after": "120" });
    }
    return geminiOk("from b");
  });
  const { generate } = createAi({ ...keys, AI_EXTRACT_CHAIN: "gemini:a,gemini:b" }, deps);
  await generate(extract);
  assert.equal(a, 1);
  advance(100_000);
  await generate(extract);
  assert.equal(a, 1); // still cooling down
  advance(30_000);
  await generate(extract);
  assert.equal(a, 2); // retried after 120 s
});

test("repeated 429s escalate the cooldown", async () => {
  let n = 0;
  const { deps, advance } = setup(async () => {
    n++;
    return status(429);
  });
  const { generate } = createAi({ ...keys, AI_EXTRACT_CHAIN: "gemini:a" }, deps);
  await assert.rejects(() => generate(extract), AiUnavailableError);
  advance(61_000);
  await assert.rejects(() => generate(extract), AiUnavailableError);
  assert.equal(n, 2);
  advance(120_000); // second strike means 10 minutes, so still cooling down
  await assert.rejects(() => generate(extract), AiUnavailableError);
  assert.equal(n, 2);
});

test("a success resets the escalation", async () => {
  const seq = [429, 200, 429, 200];
  let n = 0;
  const { deps, advance } = setup(async () => {
    const s = seq[n++];
    return s === 200 ? geminiOk("ok") : status(429);
  });
  const { generate } = createAi({ ...keys, AI_EXTRACT_CHAIN: "gemini:a" }, deps);
  await assert.rejects(() => generate(extract), AiUnavailableError);
  advance(61_000);
  await generate(extract);
  await assert.rejects(() => generate(extract), AiUnavailableError);
  advance(61_000); // back to a 60 s cooldown, not 10 minutes
  await generate(extract);
  assert.equal(n, 4);
});

test("a 404 (bad model ID) parks the model for a long time", async () => {
  let n = 0;
  const { deps, advance } = setup(async () => {
    n++;
    return status(404);
  });
  const { generate } = createAi({ ...keys, AI_EXTRACT_CHAIN: "gemini:a" }, deps);
  await assert.rejects(() => generate(extract), AiUnavailableError);
  advance(3 * 3_600_000);
  await assert.rejects(() => generate(extract), AiUnavailableError);
  assert.equal(n, 1);
});

test("truncated output tries the next model without cooling the first", async () => {
  let a = 0;
  const { deps } = setup(async (u) => {
    if (hits(u, "a")) {
      a++;
      return geminiOk('{"x":', "MAX_TOKENS");
    }
    return geminiOk("from b");
  });
  const { generate } = createAi({ ...keys, AI_EXTRACT_CHAIN: "gemini:a,gemini:b" }, deps);
  assert.equal((await generate(extract)).model, "b");
  assert.equal((await generate(extract)).model, "b");
  assert.equal(a, 2);
});

test("message tasks never reach Gemini by default, even if it is in the chain", async () => {
  let geminiCalls = 0;
  const { deps } = setup(async (u) => {
    if (isGemini(u)) {
      geminiCalls++;
      return geminiOk("leak");
    }
    return status(500);
  });
  const { generate } = createAi({ ...keys, AI_MESSAGE_CHAIN: "gemini:a,groq:x" }, deps);
  await assert.rejects(() => generate(message), AiUnavailableError);
  assert.equal(geminiCalls, 0);
});

test("message tasks may use Gemini only when explicitly allowed", async () => {
  const { deps } = setup(async () => geminiOk("ok"));
  const { generate } = createAi(
    { ...keys, AI_MESSAGE_CHAIN: "gemini:a,groq:x", AI_MESSAGES_ALLOW_GEMINI: "1" },
    deps
  );
  assert.equal((await generate(message)).provider, "gemini");
});

test("oversized input is never sent to Groq", async () => {
  let groqCalls = 0;
  const { deps } = setup(async (u) => {
    if (isGemini(u)) return status(500);
    groqCalls++;
    return groqOk("x");
  });
  const { generate } = createAi({ ...keys, AI_EXTRACT_CHAIN: "gemini:a,groq:x" }, deps);
  await assert.rejects(
    () => generate({ ...extract, prompt: "x".repeat(30_000) }),
    AiUnavailableError
  );
  assert.equal(groqCalls, 0);
});

test("when every model is cooling down it throws without any network call", async () => {
  let n = 0;
  const { deps } = setup(async () => {
    n++;
    return status(429);
  });
  const { generate } = createAi({ ...keys, AI_EXTRACT_CHAIN: "gemini:a" }, deps);
  await assert.rejects(() => generate(extract), AiUnavailableError);
  await assert.rejects(
    () => generate(extract),
    (e: unknown) =>
      e instanceof AiUnavailableError && e.attempts.some((a) => a.includes("cooling down"))
  );
  assert.equal(n, 1);
});

test("nothing configured throws and makes no network call", async () => {
  let n = 0;
  const { deps } = setup(async () => {
    n++;
    return groqOk("should not be reached");
  });
  const { generate } = createAi({}, deps);
  await assert.rejects(() => generate(extract), AiUnavailableError);
  assert.equal(n, 0);
});

test("consecutive calls to one provider are spaced out", async () => {
  const { deps, slept } = setup(async () => geminiOk("ok"));
  const { generate } = createAi({ ...keys, AI_EXTRACT_CHAIN: "gemini:a" }, deps);
  await generate(extract);
  await generate(extract);
  assert.ok(slept.length >= 1 && slept[0] >= 4000);
});

test("extractJson strips code fences", () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
});

test("extractJson throws on garbage", () => {
  assert.throws(() => extractJson("not json"));
});

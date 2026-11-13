import { generate, aiStatus } from "../lib/ai";

async function main() {
  for (const task of ["extract", "message"] as const) {
    try {
      const r = await generate({ task, system: "You are a test.", prompt: "Reply with exactly: OK" });
      console.log(
        `${task}: provider=${r.provider} model=${r.model} reply=${JSON.stringify(r.text.trim())}` +
          (r.attempts.length ? ` | skipped/failed first: ${r.attempts.join("; ")}` : "")
      );
    } catch (e) {
      console.error(`${task}: FAILED:`, e instanceof Error ? e.message : e);
    }
  }
  console.log("cooling down:", JSON.stringify(aiStatus()));
}
main();

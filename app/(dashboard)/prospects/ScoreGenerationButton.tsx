"use client";

import { useState, useTransition } from "react";
import { generateQualificationScores } from "./scoring-actions";

export default function ScoreGenerationButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  function handleGenerate() {
    setMessage("");

    startTransition(async () => {
      try {
        const result = await generateQualificationScores();

        if (!result.ok) {
          setMessage(result.error ?? "Could not generate scores.");
          return;
        }

        setMessage(
          `Successfully scored ${result.companiesScored} companies (${result.scoreRowsCreated} criterion records).`
        );

        if (result.warning) {
          setMessage((previous) => `${previous} Warning: ${result.warning}`);
        }
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "An unexpected error occurred."
        );
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleGenerate}
        disabled={pending}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Generating scores..." : "Generate scores"}
      </button>

      {message && (
        <p
          role="status"
          aria-live="polite"
          className="max-w-sm text-xs text-slate-600"
        >
          {message}
        </p>
      )}
    </div>
  );
}

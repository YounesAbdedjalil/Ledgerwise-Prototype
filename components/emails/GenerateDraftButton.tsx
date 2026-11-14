"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDraftForCompany } from "@/app/(dashboard)/emails/actions";

export default function GenerateDraftButton({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await createDraftForCompany(companyId);
            if (!result.ok || !result.draftId) {
              setError(result.error ?? "The draft could not be created.");
              return;
            }
            router.push(`/emails/${result.draftId}`);
          })
        }
        className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        title={`Generate a draft for ${companyName}`}
      >
        {pending ? "Generating..." : "Generate draft"}
      </button>
      {error && <p className="max-w-xs text-xs text-red-700">{error}</p>}
    </div>
  );
}
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type OrganizationOption = { id: string; name: string };

export default function OrganizationSwitcher({
  activeId,
  organizations,
}: {
  activeId: string;
  organizations: OrganizationOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  const router = useRouter();
  if (organizations.length < 2) return <span className="dashboard-org-name max-w-48 truncate text-xs font-semibold">{organizations[0]?.name}</span>;

  return (
    <select
      aria-label="Active organization"
      value={activeId}
      disabled={pending}
      onChange={(event) => {
        const organizationId = event.target.value;
        startTransition(async () => {
        setError(false);
        const supabase = createClient();
        const { error: switchError } = await supabase.rpc("switch_organization", { p_org: organizationId });
        if (switchError) { setError(true); return; }
        router.refresh();
        });
      }}
      className={`dashboard-org-switcher max-w-48 rounded-md border px-2 py-1.5 text-xs ${error ? "is-error" : ""}`}
    >
      {organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
    </select>
  );
}

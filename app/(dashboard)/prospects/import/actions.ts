"use server";

import { createClient } from "@/lib/supabase/server";
import { getWritableSessionUser } from "@/lib/server/auth";
import { newImportFields } from "@/lib/sources/verification";
import { validateRow, type RawRow, type ValidRow } from "@/lib/import-schema";

export type ImportResult = {
  error?: string;
  rejected: { line: number; errors: string[] }[];
  companiesCreated: number;
  sourcesAdded: number;
  duplicatesSkipped: number;
};

const empty: ImportResult = {
  rejected: [],
  companiesCreated: 0,
  sourcesAdded: 0,
  duplicatesSkipped: 0,
};

export async function importRows(
  rows: RawRow[],
  source: "csv" | "autonomous_discovery" = "csv",
): Promise<ImportResult> {
  const supabase = await createClient();
  const user = await getWritableSessionUser(supabase);
  if (!user) return { ...empty, error: "Not signed in." };
  if (rows.length === 0) return { ...empty, error: "The file has no rows." };
  if (rows.length > 2000) return { ...empty, error: "Max 2000 rows per import." };

  // Authoritative validation happens here, on the server.
  const result: ImportResult = { ...empty, rejected: [] };
  const valid: ValidRow[] = [];
  rows.forEach((raw, i) => {
    const r = validateRow(raw);
    if (r.ok) valid.push(r.row);
    else result.rejected.push({ line: i + 2, errors: r.errors }); // +2: header is line 1
  });

  const groups = new Map<string, ValidRow[]>();
  for (const row of valid) {
    groups.set(row.host, [...(groups.get(row.host) ?? []), row]);
  }

  for (const [host, groupRows] of groups) {
    const website = `https://${host}`;

    let { data: company } = await supabase
      .from("companies")
      .select("id, category, growth_signal, contact_name, contact_role, contact_email")
      .eq("website", website)
      .maybeSingle();

    if (!company) {
      const { data: created, error } = await supabase
        .from("companies")
        .insert({ name: groupRows[0].company_name, website })
        .select("id, category, growth_signal, contact_name, contact_role, contact_email")
        .single();
      if (error || !created) {
        result.rejected.push({
          line: 0,
          errors: [`Could not create ${host}: ${error?.message ?? "unknown error"}`],
        });
        continue;
      }
      company = created;
      result.companiesCreated++;
    }

    const { data: existing } = await supabase
      .from("company_sources")
      .select("claim, source_url")
      .eq("company_id", company.id);
    const seen = new Set((existing ?? []).map((s) => `${s.source_url}||${s.claim}`));

    const toInsert = groupRows
      .filter((r) => {
        const key = `${r.source_url}||${r.claim}`;
        if (seen.has(key)) {
          result.duplicatesSkipped++;
          return false;
        }
        seen.add(key);
        return true;
      })
      .map((r) => ({
        company_id: company!.id,
        claim: r.claim,
        claim_type: r.claim_type,
        source_url: r.source_url,
        source_title: r.source_title,
        retrieved_at: r.retrieved_at,
        evidence: r.evidence,
        ...newImportFields(user.id),
      }));

    if (toInsert.length > 0) {
      const { error } = await supabase.from("company_sources").insert(toInsert);
      if (error) {
        result.rejected.push({ line: 0, errors: [`Sources for ${host}: ${error.message}`] });
        continue;
      }
      result.sourcesAdded += toInsert.length;
    }


  }

  await supabase.from("audit_logs").insert({
    actor_id: user.id,
    action: source === "autonomous_discovery" ? "company_discovery_completed" : "csv_import",
    entity_type: "company_sources",
    detail: {
      import_source: source,
      rows_received: rows.length,
      companies_created: result.companiesCreated,
      sources_added: result.sourcesAdded,
      sources_pending_review: result.sourcesAdded,
      duplicates_skipped: result.duplicatesSkipped,
      rows_rejected: result.rejected.length,
    },
  });

  return result;
}

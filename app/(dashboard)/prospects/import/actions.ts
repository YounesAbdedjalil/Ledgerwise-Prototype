"use server";

import { createClient } from "@/lib/supabase/server";
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

export async function importRows(rows: RawRow[]): Promise<ImportResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
        verified_by: user.id,
      }));

    if (toInsert.length > 0) {
      const { error } = await supabase.from("company_sources").insert(toInsert);
      if (error) {
        result.rejected.push({ line: 0, errors: [`Sources for ${host}: ${error.message}`] });
        continue;
      }
      result.sourcesAdded += toInsert.length;
    }

    // Fill summary fields from sourced rows. Only overwrite values still "unknown".
    const update: Record<string, string> = {};
    if (groupRows.some((r) => r.claim_type === "us_ecommerce")) update.us_ecommerce = "verified";
    const cat = groupRows.find((r) => r.claim_type === "category");
    if (cat && company.category === "unknown") update.category = cat.claim;
    const growth = groupRows.find((r) => r.claim_type === "growth_signal");
    if (growth && company.growth_signal === "unknown") update.growth_signal = growth.claim;
    const contact = groupRows.find((r) => r.claim_type === "contact");
    if (contact && company.contact_name === "unknown") {
      const [name, role, email] = contact.claim.split("|").map((p) => p.trim());
      update.contact_name = name;
      update.contact_role = role;
      if (email && !company.contact_email) update.contact_email = email;
    }
    if (Object.keys(update).length > 0) {
      await supabase.from("companies").update(update).eq("id", company.id);
    }
  }

  await supabase.from("audit_logs").insert({
    actor_id: user.id,
    action: "csv_import",
    entity_type: "company_sources",
    detail: {
      rows_received: rows.length,
      companies_created: result.companiesCreated,
      sources_added: result.sourcesAdded,
      duplicates_skipped: result.duplicatesSkipped,
      rows_rejected: result.rejected.length,
    },
  });

  return result;
}

import Papa from "papaparse";
import type {
  CompanyResearchReport,
  ResearchOutputRow,
} from "./runner";

export const RESEARCH_COLUMNS = [
  "company_name",
  "website",
  "claim_type",
  "claim",
  "source_url",
  "source_title",
  "retrieved_at",
  "evidence",
] as const;

export function createResearchCsv(rows: ResearchOutputRow[]): string {
  return Papa.unparse({
    fields: [...RESEARCH_COLUMNS],
    data: rows.map((row) =>
      RESEARCH_COLUMNS.map((column) => row[column]),
    ),
  });
}

export function createResearchReport(
  companies: CompanyResearchReport[],
): string {
  const lines = [
    "# Ledgerwise company research report",
    "",
    `Companies processed: ${companies.length}`,
    `Pages read: ${companies.reduce((sum, company) => sum + company.pagesRead.length, 0)}`,
    `Claims proposed: ${companies.reduce((sum, company) => sum + company.proposed, 0)}`,
    `Claims accepted: ${companies.reduce((sum, company) => sum + company.accepted, 0)}`,
    `Claims rejected: ${companies.reduce((sum, company) => sum + company.rejected, 0)}`,
    "",
    "> Accepted means the evidence quotation was found in the fetched page text. It does not independently prove that the claim is true. Human review is required before importing.",
    "",
  ];

  for (const company of companies) {
    lines.push(
      `## ${company.companyName}`,
      "",
      `- Website: ${company.website}`,
      `- Pages read: ${company.pagesRead.length}`,
      `- Claims proposed: ${company.proposed}`,
      `- Claims accepted: ${company.accepted}`,
      `- Claims rejected: ${company.rejected}`,
      "",
    );

    if (company.pagesRead.length) {
      lines.push("### Pages read", "");
      for (const url of company.pagesRead) {
        lines.push(`- ${url}`);
      }
      lines.push("");
    }

    if (company.rejectedClaims.length) {
      lines.push("### Rejected claims", "");
      for (const rejected of company.rejectedClaims) {
        lines.push(`- **${rejected.claim_type || "Unknown type"}:** ${rejected.reason}`);
      }
      lines.push("");
    }

    if (company.errors.length) {
      lines.push("### Errors", "");
      for (const error of company.errors) {
        lines.push(`- ${error}`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

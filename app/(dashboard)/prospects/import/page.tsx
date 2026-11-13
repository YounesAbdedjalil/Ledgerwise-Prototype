"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { importRows, type ImportResult } from "./actions";
import { REQUIRED_COLUMNS, validateRow, type RawRow } from "@/lib/import-schema";

export default function ImportPage() {
  const [rows, setRows] = useState<RawRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  function onFile(file: File) {
    setResult(null);
    setHeaderError(null);
    setFileName(file.name);
    Papa.parse<RawRow>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: (res) => {
        const missing = REQUIRED_COLUMNS.filter((c) => !(res.meta.fields ?? []).includes(c));
        if (missing.length > 0) {
          setHeaderError(`Missing columns: ${missing.join(", ")}`);
          setRows([]);
          return;
        }
        setRows(res.data);
      },
    });
  }

  const preview = rows.map((r) => validateRow(r));
  const validCount = preview.filter((p) => p.ok).length;
  const invalid = preview
    .map((p, i) => ({ p, line: i + 2 }))
    .filter((x) => !x.p.ok) as { p: { ok: false; errors: string[] }; line: number }[];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/prospects" className="text-sm text-blue-700">
          ← Prospects
        </Link>
        <h1 className="text-2xl font-semibold mt-2">Import research CSV</h1>
        <p className="text-sm text-gray-600 mt-1">
          One row per sourced fact. Rows missing a source URL, title, date or evidence are
          rejected. Nothing is guessed or filled in for you.
        </p>
      </div>

      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        className="block text-sm"
      />

      {headerError && <p className="text-red-600 text-sm">{headerError}</p>}

      {rows.length > 0 && (
        <div className="bg-white border rounded p-4 space-y-3">
          <p className="text-sm">
            <b>{fileName}</b>: {rows.length} rows, {validCount} valid, {invalid.length} will be
            rejected.
          </p>
          {invalid.length > 0 && (
            <ul className="text-sm text-red-700 list-disc pl-5 max-h-48 overflow-auto">
              {invalid.map((x) => (
                <li key={x.line}>
                  Line {x.line}: {x.p.errors.join("; ")}
                </li>
              ))}
            </ul>
          )}
          <button
            disabled={pending || validCount === 0}
            onClick={() => startTransition(async () => setResult(await importRows(rows)))}
            className="bg-blue-600 text-white rounded px-4 py-2 text-sm disabled:opacity-50"
          >
            {pending ? "Importing..." : `Import ${validCount} valid rows`}
          </button>
        </div>
      )}

      {result && (
        <div className="bg-white border rounded p-4 text-sm space-y-2">
          {result.error ? (
            <p className="text-red-600">{result.error}</p>
          ) : (
            <>
              <p>
                Companies created: <b>{result.companiesCreated}</b> · Sources added:{" "}
                <b>{result.sourcesAdded}</b> · Duplicates skipped:{" "}
                <b>{result.duplicatesSkipped}</b> · Rejected: <b>{result.rejected.length}</b>
              </p>
              {result.rejected.length > 0 && (
                <ul className="text-red-700 list-disc pl-5">
                  {result.rejected.map((r, i) => (
                    <li key={i}>
                      {r.line > 0 ? `Line ${r.line}: ` : ""}
                      {r.errors.join("; ")}
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/prospects" className="text-blue-700 underline">
                View prospects
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}

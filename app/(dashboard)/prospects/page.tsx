import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type Row = {
  id: string;
  name: string;
  website: string;
  category: string;
  qualification_status: string;
  company_sources: { count: number }[];
};

export default async function ProspectsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("companies")
    .select("id,name,website,category,qualification_status,company_sources(count)")
    .order("name");
  const companies = (data ?? []) as Row[];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Prospects ({companies.length})</h1>
        <Link
          href="/prospects/import"
          className="bg-blue-600 text-white rounded px-4 py-2 text-sm"
        >
          Import CSV
        </Link>
      </div>
      {error && <p className="text-red-600 text-sm">{error.message}</p>}
      {companies.length === 0 ? (
        <p className="text-gray-500">No companies yet. Import your research CSV to begin.</p>
      ) : (
        <table className="w-full bg-white border rounded text-sm">
          <thead className="text-left bg-gray-100">
            <tr>
              <th className="p-2">Company</th>
              <th className="p-2">Website</th>
              <th className="p-2">Category</th>
              <th className="p-2">Sources</th>
              <th className="p-2">Score</th>
              <th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="p-2 font-medium">
                  <Link href={`/prospects/${c.id}`} className="text-blue-700 underline">
                    {c.name}
                  </Link>
                </td>
                <td className="p-2">{c.website.replace("https://", "")}</td>
                <td className="p-2">{c.category}</td>
                <td className="p-2">{c.company_sources[0]?.count ?? 0}</td>
                <td className="p-2 text-gray-400">not scored</td>
                <td className="p-2">{c.qualification_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createOrganization } from "./actions";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: orgId } = await supabase.rpc("current_organization_id");
  if (orgId) redirect("/prospects");

  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f7fb] p-6">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[.16em] text-blue-700">Workspace setup</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Create your organization</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Your organization is a private workspace for your team’s prospects, outreach, conversations, and bookings.</p>
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error === "name" ? "Enter a name between 2 and 120 characters." : "Workspace setup failed. Please try again."}</p>}
        <form action={createOrganization} className="mt-6 space-y-3">
          <label htmlFor="org-name" className="block text-sm font-medium text-slate-700">Organization name</label>
          <input id="org-name" name="name" required minLength={2} maxLength={120} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" placeholder="Acme Inc." />
          <button className="w-full rounded-lg bg-blue-700 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-800">Create workspace</button>
        </form>
      </section>
    </main>
  );
}

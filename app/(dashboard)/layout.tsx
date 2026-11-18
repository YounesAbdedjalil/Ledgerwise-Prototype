import { createClient } from "@/lib/supabase/server";
import NavLink from "@/components/NavLink";
import OrganizationSwitcher, { type OrganizationOption } from "@/components/OrganizationSwitcher";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = user?.email ?? "Workspace user";
  const initials = email.slice(0, 1).toUpperCase();
  if (!user) redirect("/login");

  const [{ data: activeId }, { data: membershipRows }] = await Promise.all([
    supabase.rpc("current_organization_id"),
    supabase.from("organization_memberships").select("organization_id,organizations(name)").eq("user_id", user.id),
  ]);
  if (!activeId) redirect("/onboarding");
  const organizations = (membershipRows ?? []).map((row) => {
    const relation = row.organizations;
    const organization = Array.isArray(relation) ? relation[0] : relation;
    return { id: row.organization_id, name: organization?.name ?? "Workspace" };
  }) as OrganizationOption[];

  return (
    <div className="dashboard-shell min-h-screen md:flex">
      <aside className="dashboard-rail relative z-10 flex w-full shrink-0 flex-col border-b border-white/10 md:fixed md:inset-y-0 md:w-[84px] md:border-b-0 md:border-r">
        <div className="dashboard-brand flex h-[72px] items-center gap-3 border-b border-white/10 px-4 md:h-[92px] md:flex-col md:justify-center md:gap-2 md:px-2">
          <div className="dashboard-mark flex h-10 w-10 items-center justify-center rounded-xl text-white">
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
              <path d="M4 19.5V5.8c0-.8.6-1.3 1.4-1.3h13.2c.8 0 1.4.5 1.4 1.3v13.7H4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/>
              <path d="M8 8h8M8 11.5h8M8 15h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="min-w-0 md:text-center">
            <div className="text-[17px] font-bold tracking-tight text-white md:text-[11px]">Ledgerwise</div>
            <div className="text-[10px] font-semibold uppercase tracking-[.15em] text-slate-400 md:hidden">Business workspace</div>
          </div>
          <form action="/auth/signout" method="post" className="ml-auto md:hidden">
            <button aria-label="Sign out" className="dashboard-signout rounded-lg border px-3 py-2 text-xs font-semibold">Sign out</button>
          </form>
        </div>

        <div className="px-4 pt-3 md:hidden">
          <OrganizationSwitcher activeId={activeId} organizations={organizations} />
        </div>

        <div className="px-3 pt-5 md:px-2 md:pt-5">
          <div className="mb-3 px-3 text-[9px] font-bold uppercase tracking-[.18em] text-slate-400 md:px-0 md:text-center">Workspace</div>
          <nav className="flex gap-1 overflow-x-auto pb-3 md:flex-col md:overflow-visible md:pb-0">
            <NavLink href="/prospects" label="Prospects" icon="building" />
            <NavLink href="/emails" label="Email review" icon="mail" />
            <NavLink href="/conversations" label="Conversations" icon="messages" />
            <NavLink href="/calendar" label="Calendar & bookings" icon="calendar" />
            <NavLink href="/settings/team" label="Team & access" icon="users" />
            <NavLink href="/settings/integrations" label="Integrations & setup" icon="settings" />
          </nav>
        </div>

        <div className="mt-auto hidden flex-col items-center gap-3 p-3 md:flex">
          <div className="dashboard-user-mark" title={email} aria-label={`Signed in as ${email}`}>{initials}</div>
          <form action="/auth/signout" method="post">
            <button aria-label="Sign out" title="Sign out" className="dashboard-signout flex h-10 w-10 items-center justify-center rounded-xl border transition">
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                <path d="M10 17l5-5-5-5M15 12H3m9-8h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0 flex-1 md:ml-[84px]">
        <header className="dashboard-topbar sticky top-0 z-[5] hidden h-[76px] items-center justify-between border-b px-8 backdrop-blur md:flex">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-200/65">Ledgerwise / Workspace</div>
            <div className="mt-1 text-sm font-semibold text-slate-100">Operations overview</div>
          </div>
          <div className="flex items-center gap-3">
            <OrganizationSwitcher activeId={activeId} organizations={organizations} />
            <div className="text-right">
              <div className="max-w-52 truncate text-xs font-semibold text-slate-100">{email}</div>
              <div className="text-[10px] uppercase tracking-[.12em] text-cyan-100/50">Workspace account</div>
            </div>
            <div className="dashboard-user-mark h-9 w-9 text-xs">{initials}</div>
          </div>
        </header>
        <main className="dashboard-main min-h-[calc(100vh-76px)] px-4 py-6 sm:px-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-[1440px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

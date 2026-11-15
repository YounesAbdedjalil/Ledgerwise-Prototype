import { createClient } from "@/lib/supabase/server";
import NavLink from "@/components/NavLink";

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

  return (
    <div className="min-h-screen md:flex">
      <aside className="relative z-10 flex w-full shrink-0 flex-col border-b border-slate-200 bg-white md:fixed md:inset-y-0 md:w-[258px] md:border-b-0 md:border-r">
        <div className="flex h-[76px] items-center gap-3 border-b border-slate-100 px-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#102f53] text-white shadow-sm">
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
              <path d="M4 19.5V5.8c0-.8.6-1.3 1.4-1.3h13.2c.8 0 1.4.5 1.4 1.3v13.7H4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/>
              <path d="M8 8h8M8 11.5h8M8 15h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-[17px] font-bold tracking-tight text-[#142b46]">Ledgerwise</div>
            <div className="text-[10px] font-semibold uppercase tracking-[.15em] text-slate-400">Business workspace</div>
          </div>
          <form action="/auth/signout" method="post" className="ml-auto md:hidden">
            <button aria-label="Sign out" className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Sign out</button>
          </form>
        </div>

        <div className="px-4 pt-7">
          <div className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Workspace</div>
          <nav className="flex gap-1 overflow-x-auto pb-3 md:flex-col md:overflow-visible md:pb-0">
            <NavLink href="/prospects" label="Prospects" icon="building" />
            <NavLink href="/emails" label="Email review" icon="mail" />
            <NavLink href="/conversations" label="Conversations" icon="messages" />
            <NavLink href="/calendar" label="Calendar & bookings" icon="calendar" />
            <NavLink href="/settings/integrations" label="Integrations & setup" icon="settings" />
          </nav>
        </div>

        <div className="mt-auto hidden p-4 md:block">
          <div className="mb-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">Signed in as</div>
            <div className="truncate text-xs font-medium text-slate-700">{email}</div>
          </div>
          <form action="/auth/signout" method="post">
            <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                <path d="M10 17l5-5-5-5M15 12H3m9-8h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0 flex-1 md:ml-[258px]">
        <header className="sticky top-0 z-[5] hidden h-[76px] items-center justify-between border-b border-slate-200/80 bg-white/90 px-8 backdrop-blur md:flex">
          <div>
            <div className="text-xs font-medium text-slate-400">Ledgerwise / Workspace</div>
            <div className="mt-0.5 text-sm font-semibold text-slate-700">Operations overview</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs font-semibold text-slate-700">{email}</div>
              <div className="text-[11px] text-slate-400">Workspace account</div>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e8f2fc] text-sm font-bold text-[#245f98]">{initials}</div>
          </div>
        </header>
        <main className="min-h-[calc(100vh-76px)] bg-[#f4f7fb] px-4 py-6 sm:px-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-[1440px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

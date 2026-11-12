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

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 border-r bg-white p-4 flex flex-col">
        <div className="font-semibold mb-6">Ledgerwise Prototype</div>
        <nav className="space-y-1 flex-1">
          <NavLink href="/prospects" label="Prospects" />
          <NavLink href="/emails" label="Email review" />
          <NavLink href="/conversations" label="Conversations" />
          <NavLink href="/calendar" label="Calendar / Bookings" />
        </nav>
        <div className="text-xs text-gray-500 mb-2 break-all">{user?.email}</div>
        <form action="/auth/signout" method="post">
          <button className="w-full border rounded px-3 py-2 text-sm hover:bg-gray-50">
            Log out
          </button>
        </form>
      </aside>
      <main className="flex-1 p-8 bg-gray-50">{children}</main>
    </div>
  );
}

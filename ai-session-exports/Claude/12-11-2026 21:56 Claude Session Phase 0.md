You are my senior full-stack engineer and product builder. Help me build a working “AI Sales Assistant” platform for Ledgerwise, a bookkeeping company, within 72 hours.
 
Your job is to guide me step by step, write production-quality code, explain decisions in plain English, and never invent facts, integrations, data, or completed features.
 
## Project context
 
Ledgerwise is a bookkeeping company. Its sales team needs a web platform where they can:
 
1. Find at least 30 real US e-commerce companies that fit Ledgerwise’s customer profile.
2. Score and qualify those companies, with clear reasons and real source links.
3. Generate short personalized first-email drafts for qualified companies.
4. Reply to prospect messages while following strict rules.
5. Book calls using real available calendar slots.
 
The sales team must remain in control:
- They must be able to view companies, scores, reasons, and sources.
- They must approve, edit, or reject email drafts before anything is sent.
- They must be able to read conversations and take over any thread.
- They must see booked calls.
 
## Non-negotiable rules
 
The AI must never:
- Quote a price or make pricing promises.
- Invent company facts, revenue, employee counts, funding, contact details, or claims.
- Continue contacting someone after they say “stop,” “unsubscribe,” “not interested,” or similar.
- Pretend to be human; if asked whether it is a bot, it must honestly disclose that it is an AI assistant.
- Handle uncertain, sensitive, legal, pricing, or unusual requests autonomously; it must escalate them to a human.
 
Implement these rules as application-level guardrails, not only as prompt instructions.
 
## Technology decisions
 
Use this stack unless you identify a materially better simple alternative:
 
- Frontend and backend: Next.js App Router.
- Database and authentication: Supabase, with email/password login.
- Hosting: Vercel.
- Code repository: GitHub.
- Calendar: Cal.com.
- AI model: Use the most suitable available model/API for research, drafting, classification, and reply handling.
- Email: Start with an approval queue. Only implement real sending if I provide verified API credentials and explicitly approve it. Otherwise label it clearly as “Simulated send — demo path.”
 
Do not use complex infrastructure. Optimize for a working, explainable, testable product.
 
## Required product screens
 
Build these four main screens:
 
1. **Prospects**
   - List of companies.
   - Company name, website, category, score, qualification status.
   - Company detail page with score breakdown, qualification reasons, source links, contact information, and research notes.
 
2. **Email review**
   - AI-generated email drafts.
   - Show the source facts beside the draft.
   - Let the salesperson edit, approve, reject, or request a revision.
   - Show status: Draft, Needs review, Approved, Rejected, Sent/Simulated send.
   - Maintain an audit trail.
 
3. **Conversations**
   - Inbox/thread view.
   - Show prospect messages, AI-drafted replies, and human replies.
   - Allow the salesperson to take over a thread.


Ledgerwise AI Sales Assistant: Phase 0 kickoff

Let’s do this in small, testable steps. I’ll start with the five questions, then give you actions you can begin right away so no time is lost.
Status board
Status	Item
Completed	Nothing yet
In progress	Phase 0 setup
Blocked	Waiting on your answers below
Next action	You answer the 5 questions; start account creation in parallel
Questions (reply in one message)

    Accounts: Do you already have GitHub, Vercel, Supabase, and Cal.com accounts? (Say which ones are missing.)
    OS: Windows, macOS, or Linux?
    Language: TypeScript or JavaScript? My recommendation is TypeScript. It catches many bugs before deploy, and I’ll write all the code so you won’t need to be fluent in it.
    Credentials: Do you have any API keys (Anthropic, OpenAI, an email provider such as Resend or SendGrid, Cal.com)? If not, that’s fine. Email stays “Simulated send — demo path” until you provide verified credentials and explicitly approve real sending.
    Names: Preferred project name and GitHub repo name? If you have no preference, I suggest ledgerwise-sales-assistant.

Things to start now (no need to wait)

A. Install the basics. Run node -v and git --version in a terminal. You need Node.js 20 or newer and Git. If either is missing, install Node LTS from nodejs.org and Git from git-scm.com.

B. Create accounts that are missing.

    GitHub: github.com
    Vercel: vercel.com. Choose “Continue with GitHub” so the two are linked.
    Supabase: supabase.com, also via GitHub login
    Cal.com: cal.com (used in Phase 5, but sign up now so you can configure availability early)

C. Start the AI session export folder. Create this structure now, because the submission requires unedited exports of every meaningful AI interaction:

ai-session-exports/
  README.md
  2026-11-12_phase0_kickoff.md

Paste this conversation, unedited, into that first file when we finish Phase 0. Don’t summarize or clean it up. I’ll remind you at the end of every phase.
Decisions I’ve made (flag any you disagree with)

    Stack: Next.js App Router + Supabase + Vercel + Cal.com, as specified. I see no materially better simple alternative.
    AI model: I’ll build with the Anthropic API behind a single lib/ai.ts wrapper. Swapping providers later means changing one file. I’ll confirm the exact current model name against Anthropic’s docs before we write that code rather than guessing it.
    Guardrails will be plain code that runs on every AI input and output, separate from any prompt. The prompt is only a second layer.
    Email: approval queue first. No real sending without your verified credentials and explicit approval.
    Research integrity: the AI can help structure and score research, but company facts must come from sources you or I actually retrieve and you verify. Anything unverified is stored as unknown. I can’t browse for you in this setup, so in Phase 1 you’ll collect URLs and evidence (I’ll give you a template), and I’ll help you structure, validate, and score them.

What I’ll deliver once you answer

    Exact commands to create the repo and scaffold Next.js
    Supabase project setup: where to click, which keys to copy, and the SQL for the users, audit_logs and other tables (Phase 0 only needs auth, but I’ll lay out the full schema next)
    .env.local template and Vercel environment variable steps
    Complete code for: login page, protected dashboard layout, four empty pages (Prospects, Emails, Conversations, Calendar), navigation, and logout
    Deployment steps and a gate checklist: live URL, working login, public repo, and a one-page scope note (I’ll draft that for you)

Send your answers and we’ll go straight into the commands.

1.I have GitHub, but no Vercel, Supabase and Cal.com
2.OS: I am using Linux, Kali Linux
3.Language: I will go with TypeScript
4.Nah sadly, I have no API keys
5.I would use Ledgerwise-Prototype as a name

I will create the required accounts in a jeffy (Vercel, Supabase, and Cal.com)

And good call, I will also create the AI session export folder
Phase 0: Setup for Ledgerwise-Prototype

Linux and TypeScript are both fine. No API keys is OK for now. Phase 0 needs none, but I’ll tell you when each one becomes necessary.
Status board
Status	Item
Completed	Questions answered
In progress	Phase 0: accounts, repo, skeleton
Blocked	Vercel, Supabase and Cal.com accounts (you’re creating them)
Next action	Steps 1 to 3 below. Do them while your accounts are being created.
One naming change

npm doesn’t allow capital letters in package names, and create-next-app will reject Ledgerwise-Prototype. I suggest using ledgerwise-prototype (lowercase) for both the GitHub repo and the folder. The product name in the UI can still be “Ledgerwise Prototype”.
Step 1: Install Node and Git (Kali)
bash

sudo apt update && sudo apt install -y git curl
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc    # use ~/.zshrc if you're on zsh (Kali's default shell is zsh)
nvm install --lts
node -v   # should print v20 or higher
git config --global user.name "Your Name"
git config --global user.email "you@example.com"

Step 2: Create the GitHub repo

    Go to github.com/new.
    Name it ledgerwise-prototype and set it to Public.
    Do not tick “Add a README”, .gitignore or license, so the repo starts empty.
    Copy the repo URL. For pushing, HTTPS needs a personal access token (GitHub → Settings → Developer settings → Tokens). Alternatively, set up an SSH key.

Step 3: Scaffold the app
bash

cd ~
npx create-next-app@latest ledgerwise-prototype --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm
cd ledgerwise-prototype
npm install @supabase/supabase-js @supabase/ssr
mkdir -p ai-session-exports docs
git remote add origin https://github.com/YOUR_USERNAME/ledgerwise-prototype.git
git branch -M main
git push -u origin main

Accept defaults for any extra prompts. Move your ai-session-exports folder into the project, or recreate it there so it’s versioned in the public repo. Before committing exports, check that they contain no API keys or passwords.
Step 4: Supabase project (after your account exists)

    Click New project. Name it ledgerwise-prototype, set a strong database password and save it in a password manager, and pick a region near you.
    Wait about 2 minutes for provisioning.
    Go to Project Settings → API and copy the Project URL and the anon / publishable key. Never use the service_role key in frontend code.
    Go to Authentication → Sign In / Providers → Email. Turn Confirm email off for the demo, which avoids needing an email provider. Also disable new signups, since this is an internal sales tool and you should control who gets access.
    Go to Authentication → Users → Add user → Create new user. Enter your email and password and tick Auto Confirm User. This is your login.

Create .env.local in the project root. It’s already gitignored.

NEXT_PUBLIC_SUPABASE_URL=https://YOURPROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-or-publishable-key

Step 5: The skeleton code

Run this one block from the project root. It creates every file.
bash

mkdir -p lib/supabase "app/login" "app/auth/signout" "app/(dashboard)/prospects" "app/(dashboard)/emails" "app/(dashboard)/conversations" "app/(dashboard)/calendar" components

cat > lib/supabase/client.ts <<'EOF'
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
EOF

cat > lib/supabase/server.ts <<'EOF'
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(list) {
          try {
            list.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component; the middleware refreshes sessions.
          }
        },
      },
    }
  );
}
EOF

cat > middleware.ts <<'EOF'
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(list) {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;

  if (!user && path !== "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/prospects";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
EOF

cat > app/page.tsx <<'EOF'
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/prospects");
}
EOF

cat > app/login/page.tsx <<'EOF'
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    router.push("/prospects");
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white p-8 rounded-lg shadow space-y-4"
      >
        <h1 className="text-2xl font-semibold">Ledgerwise Prototype</h1>
        <p className="text-sm text-gray-500">Sign in to the sales assistant.</p>
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border rounded px-3 py-2"
        />
        <input
          type="password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border rounded px-3 py-2"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white rounded py-2 disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}
EOF

cat > app/auth/signout/route.ts <<'EOF'
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
EOF

cat > components/NavLink.tsx <<'EOF'
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavLink({ href, label }: { href: string; label: string }) {
  const active = usePathname().startsWith(href);
  return (
    <Link
      href={href}
      className={`block rounded px-3 py-2 text-sm ${
        active ? "bg-blue-100 text-blue-800 font-medium" : "text-gray-700 hover:bg-gray-100"
      }`}
    >
      {label}
    </Link>
  );
}
EOF

cat > "app/(dashboard)/layout.tsx" <<'EOF'
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
EOF

make_page () {
  cat > "app/(dashboard)/$1/page.tsx" <<EOF
export default function Page() {
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2">$2</h1>
      <p className="text-gray-500">Nothing here yet. This screen is built in a later phase.</p>
    </div>
  );
}
EOF
}
make_page prospects "Prospects"
make_page emails "Email review"
make_page conversations "Conversations"
make_page calendar "Calendar / Bookings"

Test locally:
bash

npm run dev

Open http://localhost:3000. You should be redirected to /login. Sign in with the user you created and confirm you see the sidebar and the four empty pages. Then confirm Log out returns you to the login page, and that visiting /prospects while logged out redirects to login.

Version note: if npm run dev warns that middleware is deprecated (newer Next.js versions renamed it to proxy), tell me the exact message and I’ll give you the one-line rename. Don’t guess.
Step 6: Commit, then deploy on Vercel
bash

git add -A
git commit -m "Phase 0: auth skeleton with protected dashboard"
git push

    In Vercel, click Add New → Project, import ledgerwise-prototype, and leave the framework preset on Next.js.
    Open Environment Variables and add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY with the same values as .env.local.
    Click Deploy. You get a URL like ledgerwise-prototype.vercel.app.
    Log in on the live URL.

Gate checklist

    Live URL loads the login page
    Login works with your Supabase user
    Dashboard is protected, and logged-out visits redirect to login
    Four empty pages, navigation and logout work
    Public GitHub repo has the code
    ai-session-exports/ exists in the repo, with no secrets in it
    One-page scope note (I’ll draft it once the rest is confirmed)

Coming up

Phase 1 needs an AI API key if you want the AI to help structure and score research. Anthropic’s console (console.anthropic.com) requires adding credits. Decide whether you want to do that. If not, I can build the pipeline so it works with manual research entry and rule-based scoring, and add AI later. Phase 5 needs a Cal.com API key (free to create).

Tell me which steps pass or fail, and paste the exact error text for any failure. Don’t paraphrase it.
Writing the schema tables and the audit setup
Almost: I need your confirmation on Steps 1 to 3

You haven’t told me the results of the last three steps, and I won’t mark Phase 0 complete without that. Confirm these three:

    npm run build shows no middleware warning after the codemod
    docs/SCOPE.md and the session export are committed and pushed
    The live URL is still green and login still works

If all three are true, Phase 0 is closed. You can start Phase 1 now in parallel.
Your AI decision

No credits is fine, and it changes the design in an honest way:

    Email drafts will be assembled from templates that insert only verified facts from company_sources. That is arguably safer than free-form AI text, because the draft can’t contain a fact that isn’t in the database.
    Reply classification will be rule-based (keywords and patterns for opt-out, pricing, “are you a bot?”, booking intent, and an escalate-by-default fallback).
    Everything will be labeled “Rule-based mock. No LLM used.” in the UI and in HOW_I_WORKED.md. I won’t present it as AI.
    If you later want a real model, it plugs into one file (lib/ai.ts). Some providers have free API tiers, but I’d need to check their current terms before recommending one.

Phase 1, step 1: Database schema

In Supabase, open SQL Editor → New query, paste this whole block, and click Run.
sql

-- ============ USERS (profile mirror of auth.users) ============
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'sales',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- backfill the user you already created
insert into public.users (id, email)
select id, email from auth.users on conflict (id) do nothing;

-- ============ COMPANIES ============
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  website text not null,
  category text not null default 'unknown',
  us_ecommerce text not null default 'unknown'
    check (us_ecommerce in ('verified','unknown')),
  contact_name text not null default 'unknown',
  contact_role text not null default 'unknown',
  contact_email text,            -- only if publicly listed; else null
  growth_signal text not null default 'unknown',
  research_notes text,
  total_score integer not null default 0,
  qualification_status text not null default 'new'
    check (qualification_status in ('new','qualified','not_qualified','needs_review')),
  spot_checked boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============ COMPANY SOURCES (every material fact) ============
create table public.company_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  claim text not null,                       -- the fact being supported
  claim_type text not null
    check (claim_type in ('us_ecommerce','category','contact','growth_signal','size','other')),
  source_url text not null check (source_url ~* '^https?://'),
  source_title text not null,
  retrieved_at date not null,
  evidence text not null,                    -- short quote or concise summary
  verified_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

-- ============ QUALIFICATION SCORES ============
create table public.qualification_scores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  criterion text not null,
  weight integer not null check (weight > 0),
  points integer not null check (points >= 0),
  reason text not null,
  source_id uuid references public.company_sources(id) on delete set null,
  created_at timestamptz not null default now(),
  check (points <= weight),
  -- any positive score must be traceable to a source
  check (points = 0 or source_id is not null)
);

-- ============ EMAIL DRAFTS / EVENTS ============
create table public.email_drafts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  subject text not null,
  body text not null,
  status text not null default 'draft'
    check (status in ('draft','needs_review','approved','rejected','sent_simulated','sent')),
  source_ids uuid[] not null default '{}',
  revision_note text,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.email_events (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.email_drafts(id) on delete cascade,
  event_type text not null,
  actor_id uuid references public.users(id),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ============ CONVERSATIONS / MESSAGES ============
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_email text not null,
  status text not null default 'ai_handling'
    check (status in ('ai_handling','needs_human','human_takeover','closed','suppressed')),
  assigned_to uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender text not null check (sender in ('prospect','ai','human')),
  body text not null,
  classification text,
  needs_review boolean not null default false,
  guardrail_flags text[] not null default '{}',
  is_simulated boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============ CALENDAR / BOOKINGS ============
create table public.calendar_slots (
  id uuid primary key default gen_random_uuid(),
  start_time timestamptz not null,
  end_time timestamptz not null,
  timezone text not null default 'UTC',
  source text not null default 'calcom' check (source in ('calcom','demo')),
  external_id text,
  is_available boolean not null default true,
  fetched_at timestamptz not null default now(),
  check (end_time > start_time)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  slot_id uuid references public.calendar_slots(id) on delete set null,
  prospect_name text,
  prospect_email text not null,
  timezone text not null default 'UTC',
  status text not null default 'pending'
    check (status in ('pending','confirmed','needs_human','rescheduled','cancelled')),
  calcom_booking_uid text,
  created_at timestamptz not null default now()
);

-- ============ AUDIT LOG / SUPPRESSION ============
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.suppressed_contacts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  reason text not null,
  source_message_id uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index suppressed_email_unique on public.suppressed_contacts (lower(email));

-- ============ IMMUTABILITY: audit log + suppression list ============
create or replace function public.block_changes()
returns trigger language plpgsql as $$
begin
  raise exception '% on % is not allowed (append-only table)', tg_op, tg_table_name;
end $$;

create trigger audit_logs_append_only
  before update or delete on public.audit_logs
  for each row execute function public.block_changes();

create trigger suppressed_permanent
  before update or delete on public.suppressed_contacts
  for each row execute function public.block_changes();

-- ============ ROW-LEVEL SECURITY ============
do $$
declare t text;
begin
  foreach t in array array[
    'users','companies','company_sources','qualification_scores',
    'email_drafts','email_events','conversations','messages',
    'calendar_slots','bookings','audit_logs','suppressed_contacts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "auth read" on public.%I for select to authenticated using (true)', t);
  end loop;

  foreach t in array array[
    'companies','company_sources','qualification_scores','email_drafts',
    'email_events','conversations','messages','calendar_slots','bookings',
    'audit_logs','suppressed_contacts'
  ] loop
    execute format('create policy "auth insert" on public.%I for insert to authenticated with check (true)', t);
  end loop;

  foreach t in array array[
    'companies','company_sources','qualification_scores','email_drafts',
    'conversations','messages','calendar_slots','bookings'
  ] loop
    execute format('create policy "auth update" on public.%I for update to authenticated using (true) with check (true)', t);
    execute format('create policy "auth delete" on public.%I for delete to authenticated using (true)', t);
  end loop;
end $$;

Verify: in Table Editor you should see 12 tables. users should contain your email. If the SQL errors, paste the exact message and the line it points to.

What the schema enforces at the database level:

    A source can’t be saved without a URL starting with http, a title, a retrieval date and evidence.
    A score above zero must link to a source, so every reason is traceable.
    audit_logs and suppressed_contacts can’t be edited or deleted, so opt-outs are permanent.

One caveat: RLS here means “any logged-in user can do everything”. That is fine for a small internal team, and signups are disabled.
Phase 1, step 2: Draft ICP (adjust to match Ledgerwise)

I don’t know Ledgerwise’s real customer profile, so treat this as a starting proposal:

    US-based online retailer, selling its own or curated products directly to consumers (DTC)
    Verifiable US e-commerce evidence: a US shipping policy, a US address, or US storefront pricing
    Growth signals: recent funding, new product lines, a new marketplace or wholesale channel, hiring for finance or operations roles, multi-channel selling (Shopify, Amazon, wholesale)
    Likely bookkeeping pain: multiple sales channels, inventory and COGS complexity, sales tax across states
    Excluded: non-US, marketplace-only sellers with no own site, and companies that are too large (their own finance teams) or too tiny (no bookkeeping budget). Ask Ledgerwise for their size range, because I won’t invent one.

Please reply with edits, or “approved as is”.
Phase 1, step 3: Research template (start now)

Create docs/research-template.csv:
bash

cat > docs/research-template.csv <<'EOF'
company_name,website,claim_type,claim,source_url,source_title,retrieved_at,evidence
EOF

You’ll add one row per fact, so a company will have several rows. Rules for you:

    claim_type must be one of: us_ecommerce, category, contact, growth_signal, size, other
    retrieved_at is the date you actually visited the page (2026-11-12)
    evidence is a short quote or a concise summary of what the page says
    If you can’t find a fact, leave it out. Don’t guess. It will show as “unknown”.
    Aim for at least 3 facts per company: US e-commerce evidence, category, and one growth signal. A contact is optional, and only if it’s publicly listed.

Where to find candidates: Shopify’s and BigCommerce’s customer showcases, “fastest-growing e-commerce brands” lists (Inc. 5000 filtered by retail), funding announcements in retail trade press, and “Shopify store examples” roundups. Always open the company’s own site to confirm the US evidence yourself.
What I build next, in parallel

    A CSV import page that rejects any row missing a source
    The scoring model, with explicit criteria and weights for you to approve
    The Prospects list and detail pages

Reply with:

    Confirmation of the three Phase 0 checks
    Whether the SQL ran cleanly (12 tables visible)
    ICP approval or edits

Then I’ll send the import page code.

┌──(younes㉿younes)-[~/Documents/UNSCALE/ledgerwise-prototype/ledgerwise-prototype]
└─$ npm run build

    ledgerwise-prototype@0.1.0 build
    next build

▲ Next.js 16.4.6 (Turbopack)
- Environments: .env.local
✓ Running next.config.ts took 23ms

  Creating an optimized production build ...
✓ Compiled successfully in 1342ms
  Running TypeScript ...
  Finished TypeScript in 1582ms ...
  Collecting page data using 7 workers ...
✓ Collecting page data using 7 workers in 881ms
  Generating static pages using 7 workers (0/10) ...
  Generating static pages using 7 workers (2/10) 
  Generating static pages using 7 workers (4/10) 
  Generating static pages using 7 workers (7/10) 
✓ Generating static pages using 7 workers (10/10) in 265ms
  Finalizing page optimization ...
✓ Finalizing page optimization in 14ms

Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /auth/signout
├ ƒ /calendar
├ ƒ /conversations
├ ƒ /emails
├ ○ /login
└ ƒ /prospects

ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand

┌──(younes㉿younes)-[~/Documents/UNSCALE/ledgerwise-prototype/ledgerwise-prototype]
└─$ >....                                                                                                                                                 
## Current status
- Built: login, protected dashboard shell, four empty pages, deployment
- Not built yet: database schema, research data, scoring, email drafts,
  reply handling, guardrails, Cal.com integration

## Email sending
Approval queue only. Any send is labeled "Simulated send: demo path"
unless verified provider credentials are supplied and explicitly approved.

## Research integrity
Every company fact needs a source URL, title, retrieval date and evidence.
Unverifiable facts are marked "unknown".
EOF

┌──(younes㉿younes)-[~/Documents/UNSCALE/ledgerwise-prototype/ledgerwise-prototype]
└─$ git add -A

┌──(younes㉿younes)-[~/Documents/UNSCALE/ledgerwise-prototype/ledgerwise-prototype]
└─$ git commit -m "Phase 0 complete: proxy rename, scope note, session export"
[main 67be12e] Phase 0 complete: proxy rename, scope note, session export
 2 files changed, 36 insertions(+), 1 deletion(-)
 create mode 100644 docs/SCOPE.md
 rename middleware.ts => proxy.ts (95%)

┌──(younes㉿younes)-[~/Documents/UNSCALE/ledgerwise-prototype/ledgerwise-prototype]
└─$ git push
Enumerating objects: 6, done.
Counting objects: 100% (6/6), done.
Delta compression using up to 8 threads
Compressing objects: 100% (4/4), done.
Writing objects: 100% (5/5), 1.69 KiB | 1.69 MiB/s, done.
Total 5 (delta 1), reused 0 (delta 0), pack-reused 0 (from 0)
remote: Resolving deltas: 100% (1/1), completed with 1 local object.
To https://github.com/YounesAbdedjalil/Ledgerwise-Prototype.git
   4c89e3e..67be12e  main -> main

Here are the results of Steps 1 to 3 in the latest steps of Phase 0
Phase 0 results: nearly closed, two items to confirm

The build is clean, so the middleware warning is gone. The routes list still prints ƒ Proxy (Middleware), which is only the label for the renamed file, and the commit shows middleware.ts => proxy.ts. The push went through.
Status board
Status	Item
Completed	Proxy rename, clean build, docs/SCOPE.md committed and pushed
In progress	Phase 0 gate: session export and live check
Blocked	Nothing
Next action	Confirm the two items below, then run the schema SQL
Two things I can’t see in your output

1. The session export. The commit says “2 files changed” and lists only docs/SCOPE.md and the rename. That means ai-session-exports/2026-11-12_phase0_setup.md is not in this commit. You have two options:

    If you haven’t created it yet, paste this conversation into that file, check it for secrets (Supabase keys, passwords), then run:

bash

  git add -A
  git commit -m "Add Phase 0 session export"
  git push

    If it exists but wasn’t staged, check git status. The folder may be empty, or git may be ignoring it.

Also confirm the file lives in the repo folder you’re pushing from (~/Documents/UNSCALE/ledgerwise-prototype/ledgerwise-prototype), not in a separate ai-session-exports folder elsewhere. Your path shows a nested ledgerwise-prototype/ledgerwise-prototype, so it’s easy to put it one level off.

2. The live URL after the push. Vercel redeployed from commit 67be12e. Open the live site and confirm:

    Deployment shows Ready
    Login still works
    Logged-out visits to /prospects still redirect to /login

The rename touched the file that protects every route, so this check matters.
Then run the schema SQL

If you haven’t yet, paste the SQL block from my last message into Supabase → SQL Editor → New query → Run. Then check:

    Table Editor shows 12 tables
    users contains your email

If it errors, paste the exact message and the line it points to.
Still waiting on you

    ICP: reply “approved as is” or send edits. One open question needs Ledgerwise’s real answer rather than my guess: what company size range counts as a good fit?

Next, once these are confirmed

I’ll send the CSV import page, which rejects any row missing a source, followed by the scoring model with criteria and weights for you to approve. You can start collecting research with docs/research-template.csv right away. Even 5 companies with 3 facts each will let us test the import end to end.

Reply with the export result, the live check, the SQL result, and your ICP decision.

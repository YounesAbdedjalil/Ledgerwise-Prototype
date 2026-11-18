"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const publicSignupEnabled = process.env.NEXT_PUBLIC_SIGNUP_ENABLED === "1";
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    const supabase = createClient();
    const { error } = creatingAccount
      ? await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
        })
      : await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    if (creatingAccount) {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setNotice("Check your email to confirm your account, then sign in to create your workspace.");
        setLoading(false);
        return;
      }
      router.push("/onboarding");
    } else {
      router.push("/prospects");
    }
    router.refresh();
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f2f6fb] px-4 py-12">
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-blue-200/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-20 h-[30rem] w-[30rem] rounded-full bg-sky-200/30 blur-3xl" />
      <div className="relative grid w-full max-w-[920px] overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_24px_80px_rgba(23,54,88,.12)] md:grid-cols-[1fr_1fr]">
        <section className="hidden flex-col justify-between bg-[#102f53] p-10 text-white md:flex">
          <div>
            <div className="mb-12 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/10">
                <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
                  <path d="M4 19.5V5.8c0-.8.6-1.3 1.4-1.3h13.2c.8 0 1.4.5 1.4 1.3v13.7H4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/>
                  <path d="M8 8h8M8 11.5h8M8 15h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
                </svg>
              </div>
              <span className="text-xl font-bold tracking-tight">Ledgerwise</span>
            </div>
            <div className="text-xs font-bold uppercase tracking-[.2em] text-blue-200">Business workspace</div>
            <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight">Clarity for every client relationship.</h1>
            <p className="mt-4 max-w-sm text-sm leading-7 text-blue-100/80">Manage prospects, review communications, and coordinate bookings in one focused workspace.</p>
          </div>
          <div className="border-t border-white/15 pt-5 text-xs text-blue-100/60">A clearer way to manage your business pipeline.</div>
        </section>

        <form onSubmit={handleSubmit} className="flex flex-col justify-center p-7 sm:p-10 md:p-12">
          <div className="mb-8 md:hidden">
            <div className="text-xl font-bold tracking-tight text-[#142b46]">Ledgerwise</div>
            <div className="mt-1 text-xs font-medium uppercase tracking-[.14em] text-slate-400">Business workspace</div>
          </div>
          <div className="mb-8">
            <div className="text-xs font-bold uppercase tracking-[.16em] text-[#2878c7]">{creatingAccount ? "Get started" : "Welcome back"}</div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-[#142b46]">{creatingAccount ? "Create your account" : "Sign in to your account"}</h2>
            <p className="mt-2 text-sm text-slate-500">{creatingAccount ? "Create an account, confirm your email, and set up your workspace." : "Enter your credentials to access your workspace."}</p>
          </div>
          <label className="mb-2 text-xs font-semibold text-slate-700" htmlFor="email">Email address</label>
          <input id="email" type="email" required autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} className="mb-5 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100" />
          <label className="mb-2 text-xs font-semibold text-slate-700" htmlFor="password">Password</label>
          <input id="password" type="password" required autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} className="mb-5 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100" />
          {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {notice && <p role="status" className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}
          <button type="submit" disabled={loading} className="mt-1 w-full rounded-xl bg-[#2369a8] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#194f83] focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50">
            {loading ? (creatingAccount ? "Creating account..." : "Signing in...") : (creatingAccount ? "Create account" : "Sign in")}
          </button>
          {publicSignupEnabled && <button type="button" onClick={() => { setCreatingAccount(!creatingAccount); setError(null); setNotice(null); }} className="mt-4 text-sm font-medium text-blue-700 hover:underline">
            {creatingAccount ? "Already have an account? Sign in" : "New to Ledgerwise? Create an account"}
          </button>}
          <p className="mt-6 text-center text-xs text-slate-400">Secure access to your Ledgerwise workspace</p>
        </form>
      </div>
    </main>
  );
}

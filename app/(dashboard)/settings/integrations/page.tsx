import Link from "next/link";

function status(configured: boolean) {
  return configured
    ? { label: "Configured", className: "bg-green-50 text-green-800" }
    : { label: "Needs setup", className: "bg-amber-50 text-amber-800" };
}

function IntegrationCard({
  name,
  description,
  configured,
  variables,
  endpoint,
}: {
  name: string;
  description: string;
  configured: boolean;
  variables: string[];
  endpoint?: string;
}) {
  const state = status(configured);
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">{name}</h2>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${state.className}`}>{state.label}</span>
      </div>
      {endpoint && <p className="mt-3 break-all text-xs text-slate-500">Endpoint: {endpoint}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {variables.map((variable) => (
          <code key={variable} className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">{variable}</code>
        ))}
      </div>
    </section>
  );
}

export default function IntegrationsPage() {
  const supabaseReady = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const aiReady = Boolean(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY);
  const researchReady = Boolean(process.env.TAVILY_API_KEY);
  const brevoReady = Boolean(
    process.env.EMAIL_LIVE_SEND_ENABLED === "1" &&
    process.env.BREVO_API_KEY &&
    process.env.EMAIL_FROM
  );
  const googleReady = Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN &&
    process.env.GOOGLE_CALENDAR_ID &&
    process.env.GOOGLE_CALENDAR_VERIFIED === "1" &&
    process.env.GOOGLE_CALENDAR_SYNC === "1"
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/prospects" className="text-sm text-blue-700">← Workspace</Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Integrations & setup</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          This page reports whether required server-side environment variables are present. It never displays secret values and does not verify that a provider account, sender domain, API quota, or OAuth grant is valid.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <IntegrationCard name="Supabase" description="Authentication and application database." configured={supabaseReady} variables={["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]} endpoint="https://supabase.com/dashboard" />
        <IntegrationCard name="AI providers" description="Groq and/or Gemini for extraction and message generation." configured={aiReady} variables={["GROQ_API_KEY", "GEMINI_API_KEY", "AI_EXTRACT_CHAIN", "AI_MESSAGE_CHAIN"]} endpoint="https://console.groq.com/keys · https://aistudio.google.com/apikey" />
        <IntegrationCard name="Tavily research" description="Searches for candidate e-commerce companies." configured={researchReady} variables={["TAVILY_API_KEY"]} endpoint="https://app.tavily.com/home" />
        <IntegrationCard name="Brevo email" description="Real outbound email is disabled unless the explicit live-send switch and verified sender configuration are all present." configured={brevoReady} variables={["BREVO_API_KEY", "EMAIL_FROM", "EMAIL_FROM_NAME (optional)", "EMAIL_REPLY_TO (optional)", "EMAIL_LIVE_SEND_ENABLED=1"]} endpoint="https://app.brevo.com/settings/keys/api · https://api.brevo.com/v3/smtp/email" />
        <IntegrationCard name="Google Calendar" description="Optional event synchronization. The internal Ledgerwise calendar remains the source of truth." configured={googleReady} variables={["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GOOGLE_CALENDAR_ID", "GOOGLE_CALENDAR_VERIFIED=1", "GOOGLE_CALENDAR_SYNC=1"]} endpoint="https://console.cloud.google.com/apis/credentials" />
      </div>

      <section className="rounded-xl border border-blue-200 bg-blue-50 p-5">
        <h2 className="font-semibold text-blue-950">Setup instructions</h2>
        <p className="mt-1 text-sm text-blue-900">Follow the account-creation, API-key, endpoint, and environment-variable checklist in <code>docs/PROVIDER_SETUP.md</code>. Keep all secret keys in <code>.env.local</code> and your hosting provider's encrypted environment settings.</p>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
        <h2 className="font-semibold text-amber-950">Not yet connected</h2>
        <p className="mt-1 text-sm text-amber-900">Inbound email synchronization, Cal.com, subscription billing, and multi-organization membership still require the database schema and provider setup described in the project documentation. Do not treat this page as a production readiness certification.</p>
      </section>
    </div>
  );
}
